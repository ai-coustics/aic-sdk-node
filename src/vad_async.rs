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

/// Voice activity detection for use in async applications.
///
/// Initialization, processing and context creation run on Node's libuv thread pool and
/// return promises. Construction and disposal are synchronous.
///
/// Read predictions through a {@link VadContext}. Pass the original input audio to the
/// VAD before enhancement.
///
/// ### Threading
///
/// Use one instance per stream and await each operation before submitting the next.
/// Concurrent calls on one instance are not guaranteed to execute in submission order.
/// Use separate instances to process multiple streams concurrently.
///
/// The libuv pool defaults to four threads and is shared with filesystem, DNS and crypto
/// work. Set `UV_THREADPOOL_SIZE` before starting Node to change its size.
/// `AIC_NUM_THREADS` does not apply to these bindings.
#[napi(custom_finalize)]
pub struct VadAsync {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Vad<'static>>>>,
}

impl ObjectFinalize for VadAsync {
  fn finalize(self, env: Env) -> Result<()> {
    // Release the object and V8 memory estimate only for the last shared handle.
    // A pending task can retain the slot beyond finalization; see `DisposableSlot`.
    // `release` has no effect if the object was already disposed.
    if Arc::strong_count(&self.slot) == 1 {
      lock(&self.slot).release(env);
    }
    Ok(())
  }
}

#[napi]
impl VadAsync {
  /// Creates a new async voice activity detector.
  ///
  /// Construction is synchronous and throws if creation fails. Await
  /// {@link VadAsync#initialize} or {@link VadAsync#withConfig} before processing audio.
  ///
  /// @param model - Dedicated VAD model. Other model types are rejected.
  /// @param licenseKey - SDK license key from https://developers.ai-coustics.com.
  /// @param otelConfig - Optional telemetry configuration. When omitted, telemetry follows
  ///   the runtime environment.
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

  /// Destroys the native VAD and releases its telemetry session.
  ///
  /// Use this for cleanup at a specific point instead of waiting for garbage collection.
  /// After disposal, all methods except `dispose()` fail. Repeated disposal has no effect.
  ///
  /// This call blocks the calling thread while a worker holds the instance lock.
  /// Queued work that acquires the lock after disposal rejects its promise.
  #[napi]
  pub fn dispose(&self, env: Env) {
    lock(&self.slot).release(env);
  }

  /// Initializes the VAD and returns a promise for a handle to the initialized instance.
  ///
  /// Uses the same configuration as {@link VadAsync#initialize}. The returned handle and
  /// this object share the same native instance; disposing either invalidates both.
  ///
  /// ```javascript
  /// const vad = await new VadAsync(model, licenseKey).withConfig(sampleRate, blockSize)
  /// ```
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

  /// Configures the VAD for the given audio format.
  ///
  /// Await this method before processing audio. Use {@link Model#getOptimalSampleRate} and
  /// {@link Model#getOptimalBlockSize} for the most frequent prediction updates.
  /// Initialization allocates memory and runs on a libuv worker thread.
  ///
  /// @param sampleRate - Audio sample rate in Hz.
  /// @param blockSize - Number of mono samples per block.
  /// @param variableBlockSize - Allow blocks shorter than `blockSize`. Defaults to `false`.
  ///   Variable block sizes can add buffering latency. Larger blocks are always rejected.
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

  /// Updates the VAD prediction and returns a promise for the original mono audio samples.
  ///
  /// The input is copied before work is queued and remains unmodified. The promise
  /// resolves to a new `Float32Array` containing the original samples.
  ///
  /// The instance must be initialized first. The block must contain exactly `blockSize`
  /// samples, or at most `blockSize` if `variableBlockSize` is enabled.
  /// Await each call before submitting the next block.
  ///
  /// ```javascript
  /// const audio = await vad.process(block)
  /// ```
  // See the note on {@link ProcessorAsync#process} for why the buffer type is spelled out.
  #[napi(ts_return_type = "Promise<Float32Array<ArrayBuffer>>")]
  pub fn process(&self, audio: Float32Array) -> AsyncTask<VadProcessTask> {
    AsyncTask::new(VadProcessTask {
      slot: self.slot.clone(),
      // Copy on the JavaScript thread so the worker owns its input.
      audio: audio.to_vec(),
    })
  }

  /// Returns a promise for a {@link VadContext} to control this VAD and read predictions.
  ///
  /// Context creation runs on a worker thread because it may wait for processing to
  /// release the instance lock. The returned context's methods are synchronous and can
  /// be called while audio is being processed.
  #[napi(ts_return_type = "Promise<VadContext>")]
  pub fn get_context(&self) -> AsyncTask<VadContextTask> {
    AsyncTask::new(VadContextTask {
      slot: self.slot.clone(),
    })
  }

  /// Terminates the telemetry session associated with this VAD.
  ///
  /// Once termination is handled, the VAD can no longer process audio.
  /// The session also ends when the native object is destroyed. Use this method when
  /// termination must be requested at a specific lifecycle event.
  ///
  /// Termination runs on a libuv worker thread because it may block.
  /// If another session is still active, termination can complete asynchronously.
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
    // The returned handle shares the native instance and its existing memory report.
    // If disposal occurred during initialization, this handle is also disposed.
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
    // Transfer the task buffer to `resolve` without another allocation.
    let audio = std::mem::take(&mut self.audio);
    map_err(lock(&self.slot).get_mut()?.process(&audio))?;

    Ok(audio)
  }

  fn resolve(&mut self, _env: Env, audio: Vec<f32>) -> Result<Float32Array> {
    // Transfer the allocation to V8 as an external ArrayBuffer without copying.
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
