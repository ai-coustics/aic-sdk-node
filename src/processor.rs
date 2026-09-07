use crate::{
  claim_sdk_id,
  disposable_slot::DisposableSlot,
  error::{Result, map_err},
  mem,
  model::Model,
};

use napi::{Env, bindgen_prelude::Float32Array, bindgen_prelude::ObjectFinalize};
use napi_derive::napi;

/// Configurable speech enhancement parameters. Values can be changed during processing.
#[napi]
pub enum ProcessorParameter {
  /// Bypasses enhancement while preserving the processing delay.
  ///
  /// This allows enhancement to be enabled or disabled without clicks or timing changes.
  ///
  /// Range: 0.0 to 1.0. At 0.0 enhancement is active; at 1.0 audio passes through with
  /// latency compensation. Default: 0.0.
  Bypass = 0,
  /// Controls enhancement strength.
  ///
  /// Quail models apply stronger noise suppression at higher values, including suppression
  /// of competing speech for Voice Focus models. Rook models adjust the mix of original
  /// and enhanced audio.
  ///
  /// Range: 0.0 to 1.0.
  EnhancementLevel = 1,
}

impl From<ProcessorParameter> for aic_sdk::ProcessorParameter {
  fn from(parameter: ProcessorParameter) -> Self {
    match parameter {
      ProcessorParameter::Bypass => Self::Bypass,
      ProcessorParameter::EnhancementLevel => Self::EnhancementLevel,
    }
  }
}

/// OpenTelemetry configuration for a processor or VAD instance.
///
/// Overrides the SDK's environment-based telemetry settings, such as
/// `AIC_SDK_OTEL_ENABLE`, for the instance receiving this configuration.
#[napi(object)]
pub struct OtelConfig {
  /// Whether to export telemetry.
  pub enable: bool,
  /// Session ID to report. A random one is generated when omitted.
  pub session_id: Option<String>,
  /// Metric export interval in milliseconds. Omit or pass 0 for the SDK default of 60000.
  pub export_interval_ms: Option<u32>,
}

impl From<OtelConfig> for aic_sdk::OtelConfig {
  fn from(config: OtelConfig) -> Self {
    Self {
      enable: config.enable,
      session_id: config.session_id,
      export_interval_ms: config.export_interval_ms.unwrap_or(0),
    }
  }
}

/// Converts JavaScript audio settings into the SDK configuration. Block sizes use JS numbers.
pub(crate) fn audio_config(
  sample_rate: u32,
  block_size: u32,
  variable_block_size: Option<bool>,
) -> aic_sdk::ProcessorConfig {
  aic_sdk::ProcessorConfig {
    sample_rate,
    block_size: block_size as usize,
    variable_block_size: variable_block_size.unwrap_or(false),
  }
}

/// Processes mono audio with an enhancement or bypass model.
///
/// Call {@link Processor#initialize} before processing audio. Each processor maintains
/// its own state; create one instance per audio stream. Multiple processors can share
/// the same {@link Model}.
///
/// Use {@link ProcessorAsync} to run processing on Node's libuv thread pool.
#[napi(custom_finalize)]
pub struct Processor {
  // Only the JavaScript thread accesses this slot. Async classes use a shared, locked slot.
  slot: DisposableSlot<aic_sdk::Processor<'static>>,
}

impl ObjectFinalize for Processor {
  fn finalize(mut self, env: Env) -> Result<()> {
    // A no-op if `dispose()` already ran.
    self.slot.release(env);
    Ok(())
  }
}

#[napi]
impl Processor {
  /// Creates a new speech enhancement processor.
  ///
  /// Construction is synchronous and throws if creation fails. Call
  /// {@link Processor#initialize} before processing audio.
  ///
  /// @param model - Enhancement or bypass model. Other model types are rejected.
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
      Some(config) => {
        aic_sdk::Processor::with_otel_config(model_inner, &license_key, &config.into())
      }
      None => aic_sdk::Processor::new(model_inner, &license_key),
    };
    let inner = map_err(inner)?;

    Ok(Self {
      slot: DisposableSlot::new(env, inner, "Processor", mem::PROCESSOR_BYTES),
    })
  }

  /// Destroys the native processor and releases its telemetry session.
  ///
  /// Use this for cleanup at a specific point instead of waiting for garbage collection.
  /// After disposal, all methods except `dispose()` fail. Repeated disposal has no effect.
  #[napi]
  pub fn dispose(&mut self, env: Env) {
    self.slot.release(env);
  }

  /// Configures the processor for the given audio format.
  ///
  /// Call this method before processing audio. Use {@link Model#getOptimalSampleRate} and
  /// {@link Model#getOptimalBlockSize} for the lowest delay.
  /// This method allocates memory; avoid calling it from audio processing callbacks.
  ///
  /// @param sampleRate - Audio sample rate in Hz.
  /// @param blockSize - Number of mono samples per block.
  /// @param variableBlockSize - Allow blocks shorter than `blockSize`. Defaults to `false`.
  ///   Variable block sizes can add buffering latency. Larger blocks are always rejected.
  #[napi]
  pub fn initialize(
    &mut self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> Result<()> {
    map_err(self.slot.get_mut()?.initialize(&audio_config(
      sample_rate,
      block_size,
      variable_block_size,
    )))
  }

  /// Enhances a mono audio block in place.
  ///
  /// Call {@link Processor#initialize} first. The block must contain exactly `blockSize`
  /// samples, or at most `blockSize` if `variableBlockSize` is enabled.
  /// If the input uses a SharedArrayBuffer, prevent other workers from accessing it during
  /// this call.
  #[napi]
  pub fn process(&mut self, mut audio: Float32Array) -> Result<()> {
    // `Float32Array` references the caller's ArrayBuffer; processing writes into it directly.
    //
    // SAFETY: The call is synchronous and the mutable slice does not escape this function.
    // JavaScript in this isolate cannot access the buffer during the call. A caller using
    // SharedArrayBuffer must prevent concurrent access from other workers.
    let samples = unsafe { audio.as_mut() };

    map_err(self.slot.get_mut()?.process(samples))
  }

  /// Creates a handle for reading and writing this processor's parameters and state.
  ///
  /// Each call returns an independent handle to the same processor.
  #[napi]
  pub fn get_context(&self) -> Result<ProcessorContext> {
    Ok(ProcessorContext {
      inner: self.slot.get()?.context(),
    })
  }

  /// Terminates the telemetry session associated with this processor.
  ///
  /// Once termination is handled, the processor can no longer process audio.
  /// The session also ends when the native object is destroyed. Use this method when
  /// termination must be requested at a specific lifecycle event.
  ///
  /// This method may block. Avoid calling it from audio processing callbacks.
  /// If another session is still active, termination can complete asynchronously.
  #[napi]
  pub fn terminate_session(&mut self) -> Result<()> {
    map_err(self.slot.get_mut()?.terminate_session())
  }
}

/// Control handle for a {@link Processor}.
///
/// Every method may be called while audio is being processed. Handle and processor have
/// independent lifetimes: releasing the handle does not destroy the processor, and the
/// handle stays valid after its processor is disposed or garbage-collected, though its
/// calls then no longer reach a live processor.
#[napi]
pub struct ProcessorContext {
  pub(crate) inner: aic_sdk::ProcessorContext,
}

#[napi]
impl ProcessorContext {
  /// Sets an enhancement parameter. Throws if the value is out of range.
  #[napi]
  pub fn set_parameter(&self, parameter: ProcessorParameter, value: f64) -> Result<()> {
    map_err(self.inner.set_parameter(parameter.into(), value as f32))
  }

  /// Returns the current value of an enhancement parameter.
  #[napi]
  pub fn get_parameter(&self, parameter: ProcessorParameter) -> Result<f64> {
    map_err(self.inner.parameter(parameter.into())).map(f64::from)
  }

  /// Returns the audio delay in samples at the configured sample rate.
  ///
  /// Covers algorithmic delay plus any buffering from a non-optimal block size. Before
  /// initialization it reports the base delay at the model's optimal settings.
  #[napi]
  pub fn get_audio_delay(&self) -> u32 {
    self.inner.audio_delay() as u32
  }

  /// Clears internal state and buffers while preserving the configured audio settings.
  ///
  /// Call this when the stream is interrupted or when seeking to prevent previous audio
  /// from affecting the output.
  #[napi]
  pub fn reset(&self) -> Result<()> {
    map_err(self.inner.reset())
  }

  /// Replaces the bearer token on the running processor.
  ///
  /// Use this to refresh a JWT without recreating the instance. Both the original license
  /// key and the new token must be JWTs. If this call fails, the previous token remains active.
  ///
  /// A successful call validates the token's format and applies it immediately. Backend
  /// acceptance is checked later. If the backend rejects the token, the SDK retries with
  /// backoff; processing is eventually disabled if no accepted token arrives in time.
  /// Supply a valid token to recover the session.
  ///
  /// This method allocates memory and takes a mutex. Avoid calling it from audio processing callbacks.
  #[napi]
  pub fn update_bearer_token(&self, token: String) -> Result<()> {
    map_err(self.inner.update_bearer_token(&token))
  }
}
