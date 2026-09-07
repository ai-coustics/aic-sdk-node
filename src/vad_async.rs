use crate::{
  claim_sdk_id,
  disposable_slot::{DisposableSlot, lock},
  error::{Result, map_err},
  mem,
  model::Model,
  processor::{OtelConfig, audio_config},
  vad::VadContext,
};

use napi::{
  Env, Task,
  bindgen_prelude::{AsyncTask, Float32Array, ObjectFinalize},
};
use napi_derive::napi;
use std::sync::{Arc, Mutex};

/// Voice activity detector that keeps its work off the main thread.
///
/// The same detection as {@link Vad}, but each call returns a promise and runs on Node's
/// libuv thread pool, so the event loop stays responsive. Predictions are read through a
/// {@link VadContext}, whose methods are all synchronous.
///
/// Mirrors `VadAsync` in the Rust SDK.
///
/// As with {@link Vad}, feed this the **original** audio when enhancement and detection
/// run together, not a processor's output.
///
/// ### Concurrency
///
/// One instance handles one stream. Do not start a second {@link VadAsync#process} before
/// the first resolves: libuv completes work items out of order, which would desync the
/// stream and scramble the prediction. To watch several streams at once, create several
/// instances.
///
/// The libuv pool is four threads by default and is shared with `fs`, `dns` and `crypto`.
/// Raise `UV_THREADPOOL_SIZE` before Node starts to run more streams in parallel.
/// `AIC_NUM_THREADS` has no effect: it sizes a rayon pool this binding does not use.
#[napi(custom_finalize)]
pub struct VadAsync {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Vad<'static>>>>,
}

impl ObjectFinalize for VadAsync {
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
impl VadAsync {
  /// Creates a voice activity detector from a dedicated VAD model.
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
      Some(config) => aic_sdk::Vad::with_otel_config(model_inner, &license_key, &config.into()),
      None => aic_sdk::Vad::new(model_inner, &license_key),
    };
    let inner = map_err(inner)?;

    Ok(Self {
      slot: Arc::new(Mutex::new(DisposableSlot::new(
        env,
        inner,
        "VadAsync",
        mem::PROCESSOR_BYTES,
      ))),
    })
  }

  /// Destroys the native VAD immediately, releasing its memory and telemetry session
  /// without waiting for garbage collection.
  ///
  /// Every later method throws; calling `dispose()` again does nothing. Blocks until
  /// in-flight work on the libuv pool finishes.
  #[napi]
  pub fn dispose(&self, env: Env) {
    lock(&self.slot).release(env);
  }

  /// Initializes the VAD and resolves to a handle onto it, for chaining off the
  /// constructor:
  ///
  /// ```js
  /// const vad = await new VadAsync(model, licenseKey).withConfig(16000, 160)
  /// ```
  ///
  /// The handle it resolves to drives the same underlying VAD as the receiver, so either
  /// one can be used afterwards. The Rust SDK returns `self` here, which a promise cannot
  /// express.
  #[napi(ts_return_type = "Promise<VadAsync>")]
  pub fn with_config(
    &self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> AsyncTask<VadWithConfigTask> {
    AsyncTask::new(VadWithConfigTask {
      slot: self.slot.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Configures the VAD for an audio format. Must be called before processing.
  ///
  /// See {@link Vad#initialize}. Allocates, so it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn initialize(
    &self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> AsyncTask<VadInitializeTask> {
    AsyncTask::new(VadInitializeTask {
      slot: self.slot.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Examines a mono audio block, updates the prediction, and resolves to the same
  /// samples unmodified.
  ///
  /// The samples are copied out before the work is queued, so the caller's array stays
  /// valid and untouched while the promise is pending. The block is handed back, instead
  /// of the promise resolving to nothing, to match the Rust SDK and to keep a streaming
  /// loop reading the same either side of the boundary:
  ///
  /// ```js
  /// let audio = new Float32Array(blockSize)
  /// for (;;) {
  ///   audio = await vad.process(audio)
  ///   console.log(context.isSpeechDetected())
  /// }
  /// ```
  // See the note on {@link ProcessorAsync#process} for why the buffer type is spelled out.
  #[napi(ts_return_type = "Promise<Float32Array<ArrayBuffer>>")]
  pub fn process(&self, audio: Float32Array) -> AsyncTask<VadProcessTask> {
    AsyncTask::new(VadProcessTask {
      slot: self.slot.clone(),
      // Copied on the JS thread so the worker owns its samples and JS cannot mutate
      // them mid-process. A block is a couple of kilobytes, negligible next to running
      // the model over it.
      audio: audio.to_vec(),
    })
  }

  /// Creates a handle for reading predictions and controlling this VAD.
  ///
  /// Asynchronous because it takes the VAD lock, which a queued `process` may briefly
  /// hold; awaiting keeps that wait off the event loop. The returned handle is the same
  /// {@link VadContext} the synchronous class hands out, whose methods are synchronous,
  /// so a prediction can be read from inside an audio callback.
  #[napi(ts_return_type = "Promise<VadContext>")]
  pub fn get_context(&self) -> AsyncTask<VadContextTask> {
    AsyncTask::new(VadContextTask {
      slot: self.slot.clone(),
    })
  }

  /// Ends this VAD's telemetry session, after which it can no longer process audio.
  ///
  /// May block, so it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn terminate_session(&self) -> AsyncTask<VadTerminateTask> {
    AsyncTask::new(VadTerminateTask {
      slot: self.slot.clone(),
    })
  }
}

pub struct VadWithConfigTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Vad<'static>>>>,
  config: aic_sdk::ProcessorConfig,
}

impl Task for VadWithConfigTask {
  type Output = ();
  type JsValue = VadAsync;

  fn compute(&mut self) -> Result<()> {
    map_err(lock(&self.slot).get_mut()?.initialize(&self.config))
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<VadAsync> {
    // A second JS handle onto the same native VAD. The footprint was reported once at
    // construction, so nothing is reported here; the last handle's finalizer withdraws
    // it. If the VAD was disposed mid-flight, this handle starts out disposed too.
    Ok(VadAsync {
      slot: self.slot.clone(),
    })
  }
}

pub struct VadInitializeTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Vad<'static>>>>,
  config: aic_sdk::ProcessorConfig,
}

impl Task for VadInitializeTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    map_err(lock(&self.slot).get_mut()?.initialize(&self.config))
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
    Ok(())
  }
}

pub struct VadProcessTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Vad<'static>>>>,
  audio: Vec<f32>,
}

impl Task for VadProcessTask {
  type Output = Vec<f32>;
  type JsValue = Float32Array;

  fn compute(&mut self) -> Result<Vec<f32>> {
    // Moved out so `resolve` can hand the buffer to V8 without another copy. The task
    // runs once, so leaving an empty Vec behind is fine.
    let audio = std::mem::take(&mut self.audio);
    map_err(lock(&self.slot).get_mut()?.process(&audio))?;

    Ok(audio)
  }

  fn resolve(&mut self, _env: Env, audio: Vec<f32>) -> Result<Float32Array> {
    // Hands the allocation to V8 as an external ArrayBuffer, so the block is not copied
    // again on the way out.
    Ok(Float32Array::new(audio))
  }
}

pub struct VadContextTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Vad<'static>>>>,
}

impl Task for VadContextTask {
  type Output = aic_sdk::VadContext;
  type JsValue = VadContext;

  fn compute(&mut self) -> Result<aic_sdk::VadContext> {
    Ok(lock(&self.slot).get()?.context())
  }

  fn resolve(&mut self, _env: Env, context: aic_sdk::VadContext) -> Result<VadContext> {
    Ok(VadContext { inner: context })
  }
}

pub struct VadTerminateTask {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Vad<'static>>>>,
}

impl Task for VadTerminateTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    map_err(lock(&self.slot).get_mut()?.terminate_session())
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
    Ok(())
  }
}
