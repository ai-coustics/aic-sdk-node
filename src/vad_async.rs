use crate::{
  claim_sdk_id,
  error::{Result, map_err},
  mem,
  model::Model,
  processor::{OtelConfig, audio_config},
  processor_async::Held,
  vad::VadContext,
};

use napi::{
  Env, Task,
  bindgen_prelude::{AsyncTask, Float32Array, ObjectFinalize},
};
use napi_derive::napi;
use std::sync::Arc;

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
/// Raise `UV_THREADPOOL_SIZE` before Node starts to run more streams in parallel. The
/// SDK's own `AIC_NUM_THREADS` does not apply here: that variable sizes a rayon pool this
/// binding deliberately does not use.
#[napi(custom_finalize)]
pub struct VadAsync {
  inner: Arc<Held<aic_sdk::Vad<'static>>>,
}

impl ObjectFinalize for VadAsync {
  fn finalize(self, env: Env) -> Result<()> {
    // Only the last handle onto the native object destroys it; with other handles or
    // in-flight tasks holding an `Arc`, this leaves the object (and its footprint
    // report) for them. Idempotent against `dispose()`.
    if Arc::strong_count(&self.inner) == 1 {
      self.inner.release(env, mem::PROCESSOR_BYTES);
    }
    Ok(())
  }
}

#[napi]
impl VadAsync {
  /// Creates a voice activity detector from a dedicated VAD model.
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
      Some(config) => aic_sdk::Vad::with_otel_config(model_inner, &license_key, &config.into()),
      None => aic_sdk::Vad::new(model_inner, &license_key),
    };
    let inner = Arc::new(Held::new(map_err(inner)?));
    mem::adjust(env, mem::PROCESSOR_BYTES);

    Ok(Self { inner })
  }

  /// Destroys the native VAD immediately, releasing its memory and telemetry session
  /// without waiting for garbage collection.
  ///
  /// Every later method throws; calling `dispose()` again does nothing. Blocks until
  /// in-flight work on the libuv pool finishes.
  #[napi]
  pub fn dispose(&self, env: Env) {
    self.inner.release(env, mem::PROCESSOR_BYTES);
  }

  /// Initializes the VAD and resolves to a handle onto it, for chaining off the
  /// constructor:
  ///
  /// ```js
  /// const vad = await new VadAsync(model, licenseKey).withConfig(16000, 160)
  /// ```
  ///
  /// The handle it resolves to drives the same underlying VAD as the receiver, so either
  /// one can be used afterwards. Rust returns `self` here, which JS cannot express.
  #[napi(ts_return_type = "Promise<VadAsync>")]
  pub fn with_config(
    &self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> AsyncTask<VadWithConfigTask> {
    AsyncTask::new(VadWithConfigTask {
      inner: self.inner.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Configures the VAD for an audio format. Must be called before processing.
  ///
  /// See {@link Vad#initialize}. Allocates, which is why it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn initialize(
    &self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> AsyncTask<VadInitializeTask> {
    AsyncTask::new(VadInitializeTask {
      inner: self.inner.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Examines a mono audio block, updates the prediction, and resolves to the same
  /// samples unmodified.
  ///
  /// The samples are copied out before the work is queued, so the caller's array stays
  /// valid and untouched no matter what it does while the promise is pending. The block
  /// is handed back (rather than resolving to nothing) to match the Rust SDK, so a
  /// streaming loop reads the same either side of the boundary:
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
      inner: self.inner.clone(),
      // Copied on the JS thread so the worker owns its samples outright. A block is a
      // couple of kilobytes, far below the cost of running the model over it, and it
      // removes any chance of JS mutating the buffer mid-process.
      audio: audio.to_vec(),
    })
  }

  /// Creates a handle for reading predictions and controlling this VAD.
  ///
  /// Asynchronous because it takes the VAD lock, which a queued `process` may briefly
  /// hold; awaiting keeps that wait off the event loop. The returned handle is the same
  /// {@link VadContext} the synchronous class hands out, and every one of its methods is
  /// synchronous, so a prediction can be read from inside an audio callback.
  #[napi(ts_return_type = "Promise<VadContext>")]
  pub fn get_context(&self) -> AsyncTask<VadContextTask> {
    AsyncTask::new(VadContextTask {
      inner: self.inner.clone(),
    })
  }

  /// Ends this VAD's telemetry session, after which it can no longer process audio.
  ///
  /// May block, which is why it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn terminate_session(&self) -> AsyncTask<VadTerminateTask> {
    AsyncTask::new(VadTerminateTask {
      inner: self.inner.clone(),
    })
  }
}

/// Backs {@link VadAsync#withConfig}.
pub struct VadWithConfigTask {
  inner: Arc<Held<aic_sdk::Vad<'static>>>,
  config: aic_sdk::ProcessorConfig,
}

impl Task for VadWithConfigTask {
  type Output = ();
  type JsValue = VadAsync;

  fn compute(&mut self) -> Result<()> {
    self
      .inner
      .with("VadAsync", |inner| map_err(inner.initialize(&self.config)))
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<VadAsync> {
    // A second JS handle onto the same native VAD. The footprint is reported once per
    // object at construction, so there is nothing to report here; the last handle's
    // finalizer gives it back. Born disposed when the VAD was disposed mid-flight.
    Ok(VadAsync {
      inner: self.inner.clone(),
    })
  }
}

/// Backs {@link VadAsync#initialize}.
pub struct VadInitializeTask {
  inner: Arc<Held<aic_sdk::Vad<'static>>>,
  config: aic_sdk::ProcessorConfig,
}

impl Task for VadInitializeTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    self
      .inner
      .with("VadAsync", |inner| map_err(inner.initialize(&self.config)))
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
    Ok(())
  }
}

/// Backs {@link VadAsync#process}.
pub struct VadProcessTask {
  inner: Arc<Held<aic_sdk::Vad<'static>>>,
  audio: Vec<f32>,
}

impl Task for VadProcessTask {
  type Output = Vec<f32>;
  type JsValue = Float32Array;

  fn compute(&mut self) -> Result<Vec<f32>> {
    // Moved out rather than borrowed so the buffer can be handed to V8 in `resolve`
    // without another copy. The task is used once, so leaving an empty Vec behind is fine.
    let audio = std::mem::take(&mut self.audio);
    self
      .inner
      .with("VadAsync", |inner| map_err(inner.process(&audio)))?;

    Ok(audio)
  }

  fn resolve(&mut self, _env: Env, audio: Vec<f32>) -> Result<Float32Array> {
    // Hands the allocation to V8 as an external ArrayBuffer, so the block is not copied
    // again on the way out.
    Ok(Float32Array::new(audio))
  }
}

/// Backs {@link VadAsync#getContext}.
pub struct VadContextTask {
  inner: Arc<Held<aic_sdk::Vad<'static>>>,
}

impl Task for VadContextTask {
  type Output = aic_sdk::VadContext;
  type JsValue = VadContext;

  fn compute(&mut self) -> Result<aic_sdk::VadContext> {
    self.inner.with("VadAsync", |inner| Ok(inner.context()))
  }

  fn resolve(&mut self, _env: Env, context: aic_sdk::VadContext) -> Result<VadContext> {
    Ok(VadContext { inner: context })
  }
}

/// Backs {@link VadAsync#terminateSession}.
pub struct VadTerminateTask {
  inner: Arc<Held<aic_sdk::Vad<'static>>>,
}

impl Task for VadTerminateTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    self
      .inner
      .with("VadAsync", |inner| map_err(inner.terminate_session()))
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
    Ok(())
  }
}
