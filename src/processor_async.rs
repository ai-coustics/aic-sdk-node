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

/// Speech enhancement for use in async applications.
///
/// Initialization, processing and context creation run on Node's libuv thread pool and
/// return promises. Construction and disposal are synchronous.
///
/// Use {@link Processor} when processing should run on the calling thread.
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
pub struct ProcessorAsync {
  slot: Arc<Mutex<DisposableSlot<aic_sdk::Processor<'static>>>>,
}

impl ObjectFinalize for ProcessorAsync {
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
impl ProcessorAsync {
  /// Creates a new async speech enhancement processor.
  ///
  /// Construction is synchronous and throws if creation fails. Await
  /// {@link ProcessorAsync#initialize} or {@link ProcessorAsync#withConfig} before processing audio.
  ///
  /// @param model - Enhancement or bypass model. Other model types are rejected.
  /// @param licenseKey - SDK license key from <https://developers.ai-coustics.com>.
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

  /// Destroys the native processor and releases its telemetry session.
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

  /// Initializes the processor and returns a promise for a handle to the initialized instance.
  ///
  /// Uses the same configuration as {@link ProcessorAsync#initialize}. The returned handle and
  /// this object share the same native instance; disposing either invalidates both.
  ///
  /// ```javascript
  /// const processor = await new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)
  /// ```
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

  /// Configures the processor for the given audio format.
  ///
  /// Await this method before processing audio. Use {@link Model#getOptimalSampleRate} and
  /// {@link Model#getOptimalBlockSize} for the lowest delay.
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
  ) -> AsyncTask<ProcessorInitializeTask> {
    AsyncTask::new(ProcessorInitializeTask {
      slot: self.slot.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Enhances a mono audio block and returns a promise for the enhanced samples.
  ///
  /// The input is copied before work is queued and remains unmodified. The promise
  /// resolves to a new `Float32Array` containing the enhanced samples.
  ///
  /// The instance must be initialized first. The block must contain exactly `blockSize`
  /// samples, or at most `blockSize` if `variableBlockSize` is enabled.
  /// Await each call before submitting the next block.
  ///
  /// ```javascript
  /// const enhanced = await processor.process(block)
  /// ```
  // Specify ArrayBuffer so the result is assignable to a variable inferred from
  // `new Float32Array(n)`. The returned buffer is never a SharedArrayBuffer.
  #[napi(ts_return_type = "Promise<Float32Array<ArrayBuffer>>")]
  pub fn process(&self, audio: Float32Array) -> AsyncTask<ProcessorProcessTask> {
    AsyncTask::new(ProcessorProcessTask {
      slot: self.slot.clone(),
      // Copy on the JavaScript thread so the worker owns its input.
      audio: audio.to_vec(),
    })
  }

  /// Returns a promise for a {@link ProcessorContext} to control this processor.
  ///
  /// Context creation runs on a worker thread because it may wait for processing to
  /// release the instance lock. The returned context's methods are synchronous and can
  /// be called while audio is being processed.
  #[napi(ts_return_type = "Promise<ProcessorContext>")]
  pub fn get_context(&self) -> AsyncTask<ProcessorContextTask> {
    AsyncTask::new(ProcessorContextTask {
      slot: self.slot.clone(),
    })
  }

  /// Terminates the telemetry session associated with this processor.
  ///
  /// Once termination is handled, the processor can no longer process audio.
  /// The session also ends when the native object is destroyed. Use this method when
  /// termination must be requested at a specific lifecycle event.
  ///
  /// Termination runs on a libuv worker thread because it may block.
  /// If another session is still active, termination can complete asynchronously.
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
    // The returned handle shares the native instance and its existing memory report.
    // If disposal occurred during initialization, this handle is also disposed.
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
    // Transfer the task buffer to `resolve` without another allocation.
    let mut audio = std::mem::take(&mut self.audio);
    map_err(lock(&self.slot).get_mut()?.process(&mut audio))?;

    Ok(audio)
  }

  fn resolve(&mut self, _env: Env, audio: Vec<f32>) -> Result<Float32Array> {
    // Transfer the allocation to V8 as an external ArrayBuffer without copying.
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
