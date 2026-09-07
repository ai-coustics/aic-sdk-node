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
/// Raise `UV_THREADPOOL_SIZE` before Node starts to run more streams in parallel.
/// `AIC_NUM_THREADS` has no effect: it sizes a rayon pool this binding does not use.
#[napi(custom_finalize)]
pub struct ProcessorAsync {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
}

impl ObjectFinalize for ProcessorAsync {
  fn finalize(self, env: Env) -> Result<()> {
    // Only the last handle destroys the native object; while other handles or in-flight
    // tasks hold an `Arc`, this leaves the object and its footprint report to them.
    // A no-op if `dispose()` already ran.
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
  /// audio work runs on a worker thread.
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
  /// either one can be used afterwards. The Rust SDK returns `self` here, which a promise
  /// cannot express.
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
  /// See {@link Processor#initialize}. Allocates, so it runs on a worker.
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
  /// untouched while the promise is pending, and the result arrives as a new array:
  ///
  /// ```js
  /// let audio = new Float32Array(blockSize)
  /// for (;;) audio = await processor.process(audio)
  /// ```
  ///
  /// The block must be exactly `blockSize` samples, or at most `blockSize` if
  /// `variableBlockSize` was enabled.
  // The buffer parameter is spelled out because TypeScript widens a bare `Float32Array`
  // to `Float32Array<ArrayBufferLike>`, which does not assign back to a
  // `let audio = new Float32Array(n)` and so breaks the reuse loop above. The buffer
  // handed to V8 is always a plain, non-shared ArrayBuffer, so the narrower type holds.
  #[napi(ts_return_type = "Promise<Float32Array<ArrayBuffer>>")]
  pub fn process(&self, audio: Float32Array) -> AsyncTask<ProcessorProcessTask> {
    AsyncTask::new(ProcessorProcessTask {
      slot: self.slot.clone(),
      // Copied on the JS thread so the worker owns its samples and JS cannot mutate
      // them mid-process. A block is a couple of kilobytes, negligible next to running
      // the model over it.
      audio: audio.to_vec(),
    })
  }

  /// Creates a handle for reading and writing this processor's parameters and state.
  ///
  /// Asynchronous because it takes the processor lock, which a queued `process` may
  /// briefly hold; awaiting keeps that wait off the event loop. The returned handle is
  /// the same {@link ProcessorContext} the synchronous class hands out, with the same
  /// synchronous methods.
  #[napi(ts_return_type = "Promise<ProcessorContext>")]
  pub fn get_context(&self) -> AsyncTask<ProcessorContextTask> {
    AsyncTask::new(ProcessorContextTask {
      slot: self.slot.clone(),
    })
  }

  /// Ends this processor's telemetry session, after which it can no longer process audio.
  ///
  /// May block, so it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn terminate_session(&self) -> AsyncTask<ProcessorTerminateTask> {
    AsyncTask::new(ProcessorTerminateTask {
      slot: self.slot.clone(),
    })
  }
}

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
    // A second JS handle onto the same native processor. The footprint was reported once
    // at construction, so nothing is reported here; the last handle's finalizer withdraws
    // it. If the processor was disposed mid-flight, this handle starts out disposed too.
    Ok(ProcessorAsync {
      slot: self.slot.clone(),
    })
  }
}

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

pub struct ProcessorProcessTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
  audio: Vec<f32>,
}

impl Task for ProcessorProcessTask {
  type Output = Vec<f32>;
  type JsValue = Float32Array;

  fn compute(&mut self) -> Result<Vec<f32>> {
    // Moved out so `resolve` can hand the buffer to V8 without another copy. The task
    // runs once, so leaving an empty Vec behind is fine.
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
