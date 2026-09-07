use crate::{
  claim_sdk_id,
  disposable_slot::DisposableSlot,
  error::{Result, map_err},
  mem,
  model::Model,
  processor::{OtelConfig, audio_config},
};

use napi::{Env, bindgen_prelude::Float32Array, bindgen_prelude::ObjectFinalize};
use napi_derive::napi;

/// Configurable voice activity detection parameters. Values can be changed during processing.
#[napi]
pub enum VadParameter {
  /// Controls how long the VAD continues reporting speech after speech stops.
  ///
  /// Speech is reported if at least half the blocks processed in the last
  /// `speechHoldDuration * 2` seconds contained speech. Additional speech during this
  /// period extends the detection period.
  ///
  /// The duration is rounded to the nearest model window length, so the value read back
  /// may differ from the value set.
  ///
  /// Range: 0.0 to 300 times the model window length, in seconds. Default: model-specific.
  SpeechHoldDuration = 0,
  /// Sets the probability threshold for detecting speech in an audio block.
  ///
  /// A model probability above this threshold counts as speech.
  ///
  /// Range: 0.0 to 1.0. Default: model-specific.
  Sensitivity = 1,
  /// Controls how long speech must be present before the VAD reports speech.
  ///
  /// The duration is rounded to the nearest model window length, so the value read back
  /// may differ from the value set.
  ///
  /// Range: 0.0 to 1.0 seconds. Default: model-specific.
  MinimumSpeechDuration = 2,
}

impl From<VadParameter> for aic_sdk::VadParameter {
  fn from(parameter: VadParameter) -> Self {
    match parameter {
      VadParameter::SpeechHoldDuration => Self::SpeechHoldDuration,
      VadParameter::Sensitivity => Self::Sensitivity,
      VadParameter::MinimumSpeechDuration => Self::MinimumSpeechDuration,
    }
  }
}

/// Detects speech using a dedicated VAD model.
///
/// Call {@link Vad#initialize}, then pass mono audio to {@link Vad#process}.
/// Processing leaves the audio unmodified and updates the prediction, which can be read
/// through a {@link VadContext}.
///
/// When using enhancement and detection together, pass the original input to the VAD
/// before calling {@link Processor#process}. Enhanced audio changes the signal seen by
/// the VAD and adds the processor's audio delay to the prediction delay.
#[napi(custom_finalize)]
pub struct Vad {
  // Only the JavaScript thread accesses this slot. Async classes use a shared, locked slot.
  slot: DisposableSlot<aic_sdk::Vad<'static>>,
}

impl ObjectFinalize for Vad {
  fn finalize(mut self, env: Env) -> Result<()> {
    // A no-op if `dispose()` already ran.
    self.slot.release(env);
    Ok(())
  }
}

#[napi]
impl Vad {
  /// Creates a new voice activity detector.
  ///
  /// Construction is synchronous and throws if creation fails. Call
  /// {@link Vad#initialize} before processing audio.
  ///
  /// @param model - Dedicated VAD model. Other model types are rejected.
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
      Some(config) => aic_sdk::Vad::with_otel_config(model_inner, &license_key, &config.into()),
      None => aic_sdk::Vad::new(model_inner, &license_key),
    };
    let inner = map_err(inner)?;

    Ok(Self {
      slot: DisposableSlot::new(env, inner, "Vad", mem::PROCESSOR_BYTES),
    })
  }

  /// Destroys the native VAD and releases its telemetry session.
  ///
  /// Use this for cleanup at a specific point instead of waiting for garbage collection.
  /// After disposal, all methods except `dispose()` fail. Repeated disposal has no effect.
  #[napi]
  pub fn dispose(&mut self, env: Env) {
    self.slot.release(env);
  }

  /// Configures the VAD for the given audio format.
  ///
  /// Call this method before processing audio. Use {@link Model#getOptimalSampleRate} and
  /// {@link Model#getOptimalBlockSize} for the most frequent prediction updates.
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

  /// Processes a mono audio block and updates the VAD prediction without modifying the input.
  ///
  /// Call {@link Vad#initialize} first. The block must contain exactly `blockSize` samples,
  /// or at most `blockSize` if `variableBlockSize` is enabled.
  #[napi]
  pub fn process(&mut self, audio: Float32Array) -> Result<()> {
    // Borrow the typed-array contents without copying or modifying them.
    map_err(self.slot.get_mut()?.process(&audio))
  }

  /// Creates a handle for reading predictions and controlling this VAD.
  ///
  /// Each call returns an independent handle to the same VAD.
  #[napi]
  pub fn get_context(&self) -> Result<VadContext> {
    Ok(VadContext {
      inner: self.slot.get()?.context(),
    })
  }

  /// Terminates the telemetry session associated with this VAD.
  ///
  /// Once termination is handled, the VAD can no longer process audio.
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

/// Control handle for a {@link Vad}.
///
/// Every method may be called while audio is being processed. If the backing VAD is
/// released the prediction stops updating, but this handle stays valid.
#[napi]
pub struct VadContext {
  pub(crate) inner: aic_sdk::VadContext,
}

#[napi]
impl VadContext {
  /// Sets a VAD parameter. Throws if the value is out of range.
  #[napi]
  pub fn set_parameter(&self, parameter: VadParameter, value: f64) -> Result<()> {
    map_err(self.inner.set_parameter(parameter.into(), value as f32))
  }

  /// Returns the current value of a VAD parameter.
  #[napi]
  pub fn get_parameter(&self, parameter: VadParameter) -> Result<f64> {
    map_err(self.inner.parameter(parameter.into())).map(f64::from)
  }

  /// Returns whether speech is currently detected.
  ///
  /// The decision lags its input by {@link VadContext#getPredictionDelay} samples, and
  /// stops updating if the backing VAD stops being processed.
  #[napi]
  pub fn is_speech_detected(&self) -> bool {
    self.inner.is_speech_detected()
  }

  /// Returns the model's speech probability in the range 0.0 to 1.0.
  ///
  /// This value excludes speech hold, sensitivity thresholding and minimum speech duration.
  /// Use it to implement custom detection logic. The prediction delay reported by
  /// {@link VadContext#getPredictionDelay} also applies to this value.
  #[napi]
  pub fn get_raw_vad_probability(&self) -> f64 {
    self.inner.raw_vad_probability().into()
  }

  /// Returns the prediction delay in samples at the configured sample rate.
  ///
  /// Includes input buffering, STFT and model processing. Non-optimal or variable block
  /// sizes can add buffering latency. Convert to milliseconds with
  /// `delaySamples * 1000 / sampleRate`.
  ///
  /// Use this delay to align speech decisions with the input audio. It is independent of
  /// a processor's audio delay; VAD processing does not delay or modify the audio.
  #[napi]
  pub fn get_prediction_delay(&self) -> u32 {
    self.inner.prediction_delay() as u32
  }

  /// Clears internal state and buffers, including the published speech decision and probability.
  ///
  /// Call this when the stream is interrupted or when seeking to prevent predictions
  /// from using previous audio. The VAD remains initialized with its configured settings.
  #[napi]
  pub fn reset(&self) -> Result<()> {
    map_err(self.inner.reset())
  }

  /// Replaces the bearer token on the running VAD.
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
