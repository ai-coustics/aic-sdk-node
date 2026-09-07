use crate::{
  claim_sdk_id,
  disposable_slot::{DisposableSlot, lock},
  error::{Result, map_err},
  mem,
  model::Model,
  processor::{OtelConfig, ProcessorContext, audio_config},
};

use napi::{
  Env, Task,
  bindgen_prelude::{AsyncTask, Float32Array, ObjectFinalize},
};
use napi_derive::napi;
use std::sync::{Arc, Mutex};

/// Speech enhancement processor that keeps its work off the main thread.
///
/// The same processing as {@link Processor}, but each call returns a promise and runs on
/// Node's libuv thread pool, so the event loop stays responsive. Prefer this when other
/// work shares that loop, as in a server; prefer {@link Processor} on a dedicated audio
/// thread or in a batch script, where nothing else needs the loop.
///
/// Mirrors `ProcessorAsync` in the Rust SDK.
///
/// ### Concurrency
///
/// One instance handles one stream. Do not start a second {@link ProcessorAsync#process}
/// before the first resolves: libuv completes work items out of order, which would
/// desync the stream. To process several streams at once, create several instances.
///
/// The libuv pool is four threads by default and is shared with `fs`, `dns` and `crypto`.
/// Raise `UV_THREADPOOL_SIZE` before Node starts to run more streams in parallel. The
/// SDK's own `AIC_NUM_THREADS` does not apply here: that variable sizes a rayon pool this
/// binding deliberately does not use.
#[napi(custom_finalize)]
pub struct ProcessorAsync {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
}

impl ObjectFinalize for ProcessorAsync {
  fn finalize(self, env: Env) -> Result<()> {
    // Only the last handle onto the native object destroys it; with other handles or
    // in-flight tasks holding an `Arc`, this leaves the object (and its footprint
    // report) for them. Idempotent against `dispose()`.
    if Arc::strong_count(&self.slot) == 1 {
      lock(&self.slot).release(env);
    }
    Ok(())
  }
}

#[napi]
impl ProcessorAsync {
  /// Creates a processor from an enhancement or bypass model.
  ///
  /// Construction is synchronous and throws on failure, as in the Rust SDK; only the
  /// audio work is deferred to a worker thread.
  ///
  /// Telemetry follows the runtime environment; pass `otelConfig` to override it for this
  /// instance.
  #[napi(constructor)]
  pub fn new(
    env: Env,
    model: &Model,
    license_key: String,
    otel_config: Option<OtelConfig>,
  ) -> Result<Self> {
    let model_inner = model.inner()?;
    claim_sdk_id();
    let inner = match otel_config {
      Some(config) => {
        aic_sdk::Processor::with_otel_config(model_inner, &license_key, &config.into())
      }
      None => aic_sdk::Processor::new(model_inner, &license_key),
    };
    let inner = map_err(inner)?;

    Ok(Self {
      slot: Arc::new(Mutex::new(DisposableSlot::new(
        env,
        inner,
        "ProcessorAsync",
        mem::PROCESSOR_BYTES,
      ))),
    })
  }

  /// Destroys the native processor immediately, releasing its memory and telemetry
  /// session without waiting for garbage collection.
  ///
  /// Every later method throws; calling `dispose()` again does nothing. Blocks until
  /// in-flight work on the libuv pool finishes.
  #[napi]
  pub fn dispose(&self, env: Env) {
    lock(&self.slot).release(env);
  }

  /// Initializes the processor and resolves to a handle onto it, for chaining off the
  /// constructor:
  ///
  /// ```js
  /// const processor = await new ProcessorAsync(model, licenseKey).withConfig(48000, 480)
  /// ```
  ///
  /// The handle it resolves to drives the same underlying processor as the receiver, so
  /// either one can be used afterwards. Rust returns `self` here, which JS cannot express.
  #[napi(ts_return_type = "Promise<ProcessorAsync>")]
  pub fn with_config(
    &self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> AsyncTask<ProcessorWithConfigTask> {
    AsyncTask::new(ProcessorWithConfigTask {
      slot: self.slot.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Configures the processor for an audio format. Must be called before processing.
  ///
  /// See {@link Processor#initialize}. Allocates, which is why it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn initialize(
    &self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> AsyncTask<ProcessorInitializeTask> {
    AsyncTask::new(ProcessorInitializeTask {
      slot: self.slot.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Enhances a mono audio block and resolves to the enhanced samples.
  ///
  /// Unlike {@link Processor#process} this does **not** write into the caller's array.
  /// The samples are copied out before the work is queued, so the input stays valid and
  /// untouched no matter what the caller does while the promise is pending, and the
  /// result arrives as a new array:
  ///
  /// ```js
  /// let audio = new Float32Array(blockSize)
  /// for (;;) audio = await processor.process(audio)
  /// ```
  ///
  /// The block must be exactly `blockSize` samples, or at most `blockSize` if
  /// `variableBlockSize` was enabled.
  // Spelled out as `Float32Array<ArrayBuffer>` rather than a bare `Float32Array`, which
  // TypeScript widens to `Float32Array<ArrayBufferLike>`, which would not assign back to
  // a `let audio = new Float32Array(n)`, breaking the reuse loop above. The buffer handed
  // to V8 is always a plain ArrayBuffer, never shared, so the narrower type is accurate.
  #[napi(ts_return_type = "Promise<Float32Array<ArrayBuffer>>")]
  pub fn process(&self, audio: Float32Array) -> AsyncTask<ProcessorProcessTask> {
    AsyncTask::new(ProcessorProcessTask {
      slot: self.slot.clone(),
      // Copied on the JS thread so the worker owns its samples outright. A block is a
      // couple of kilobytes, far below the cost of running the model over it, and it
      // removes any chance of JS mutating the buffer mid-process.
      audio: audio.to_vec(),
    })
  }

  /// Creates a handle for reading and writing this processor's parameters and state.
  ///
  /// Asynchronous because it takes the processor lock, which a queued `process` may
  /// briefly hold; awaiting keeps that wait off the event loop. The returned handle is
  /// the same {@link ProcessorContext} the synchronous class hands out, and every one of
  /// its methods is synchronous.
  #[napi(ts_return_type = "Promise<ProcessorContext>")]
  pub fn get_context(&self) -> AsyncTask<ProcessorContextTask> {
    AsyncTask::new(ProcessorContextTask {
      slot: self.slot.clone(),
    })
  }

  /// Ends this processor's telemetry session, after which it can no longer process audio.
  ///
  /// May block, which is why it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn terminate_session(&self) -> AsyncTask<ProcessorTerminateTask> {
    AsyncTask::new(ProcessorTerminateTask {
      slot: self.slot.clone(),
    })
  }
}

/// Backs {@link ProcessorAsync#withConfig}.
pub struct ProcessorWithConfigTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
  config: aic_sdk::ProcessorConfig,
}

impl Task for ProcessorWithConfigTask {
  type Output = ();
  type JsValue = ProcessorAsync;

  fn compute(&mut self) -> Result<()> {
    map_err(lock(&self.slot).get_mut()?.initialize(&self.config))
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<ProcessorAsync> {
    // A second JS handle onto the same native processor. The footprint is reported once
    // per object at construction, so there is nothing to report here; the last handle's
    // finalizer gives it back. Born disposed when the processor was disposed mid-flight.
    Ok(ProcessorAsync {
      slot: self.slot.clone(),
    })
  }
}

/// Backs {@link ProcessorAsync#initialize}.
pub struct ProcessorInitializeTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
  config: aic_sdk::ProcessorConfig,
}

impl Task for ProcessorInitializeTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    map_err(lock(&self.slot).get_mut()?.initialize(&self.config))
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
    Ok(())
  }
}

/// Backs {@link ProcessorAsync#process}.
pub struct ProcessorProcessTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
  audio: Vec<f32>,
}

impl Task for ProcessorProcessTask {
  type Output = Vec<f32>;
  type JsValue = Float32Array;

  fn compute(&mut self) -> Result<Vec<f32>> {
    // Moved out rather than borrowed so the buffer can be handed to V8 in `resolve`
    // without another copy. The task is used once, so leaving an empty Vec behind is fine.
    let mut audio = std::mem::take(&mut self.audio);
    map_err(lock(&self.slot).get_mut()?.process(&mut audio))?;

    Ok(audio)
  }

  fn resolve(&mut self, _env: Env, audio: Vec<f32>) -> Result<Float32Array> {
    // Hands the allocation to V8 as an external ArrayBuffer, so the enhanced samples
    // are not copied again on the way out.
    Ok(Float32Array::new(audio))
  }
}

/// Backs {@link ProcessorAsync#getContext}.
pub struct ProcessorContextTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
}

impl Task for ProcessorContextTask {
  type Output = aic_sdk::ProcessorContext;
  type JsValue = ProcessorContext;

  fn compute(&mut self) -> Result<aic_sdk::ProcessorContext> {
    Ok(lock(&self.slot).get()?.context())
  }

  fn resolve(&mut self, _env: Env, context: aic_sdk::ProcessorContext) -> Result<ProcessorContext> {
    Ok(ProcessorContext { inner: context })
  }
}

/// Backs {@link ProcessorAsync#terminateSession}.
pub struct ProcessorTerminateTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
}

impl Task for ProcessorTerminateTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    map_err(lock(&self.slot).get_mut()?.terminate_session())
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
    Ok(())
  }
}
