use crate::{
  claim_sdk_id,
  error::{Result, map_err},
  model::Model,
  processor::{OtelConfig, audio_config},
};

use napi::bindgen_prelude::Float32Array;
use napi_derive::napi;

/// Voice activity detection parameters, all changeable while audio is being processed.
#[napi]
pub enum VadParameter {
  /// How long the VAD keeps reporting speech after speech stops, which stabilizes
  /// detected -> not-detected transitions.
  ///
  /// Speech is reported when at least half the blocks in the last
  /// `speechHoldDuration * 2` seconds contained speech, so ongoing speech extends the
  /// hold. Rounded to the model's window length, so reads may differ from writes.
  ///
  /// Range 0.0 to 300x the model window length, in seconds. Model-specific default.
  SpeechHoldDuration = 0,
  /// Probability threshold above which a block counts as speech, stabilizing how
  /// readily speech is detected at all.
  ///
  /// Range 0.0 - 1.0. Model-specific default.
  Sensitivity = 1,
  /// How long speech must be present before the VAD reports it, which stabilizes
  /// not-detected -> detected transitions.
  ///
  /// Rounded to the model's window length, so reads may differ from writes.
  /// Range 0.0 - 1.0, in seconds. Model-specific default.
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

/// Voice activity detector running a dedicated VAD model.
///
/// Driven explicitly through {@link Vad#process} and independent of any
/// {@link Processor}; predictions are read through a {@link VadContext}. Enhancement
/// models are rejected.
///
/// When enhancement and detection run together, feed this the **original** audio, not the
/// processor's output: enhancement changes the signal the VAD model expects, and stacks
/// the processor's delay onto the prediction. Since `process` leaves its input untouched,
/// calling it on the same block before `Processor#process` is enough.
#[napi]
pub struct Vad {
  inner: aic_sdk::Vad<'static>,
}

#[napi]
impl Vad {
  /// Creates a voice activity detector from a dedicated VAD model.
  ///
  /// Telemetry follows the runtime environment; pass `otelConfig` to override it for this
  /// instance.
  #[napi(constructor)]
  pub fn new(model: &Model, license_key: String, otel_config: Option<OtelConfig>) -> Result<Self> {
    claim_sdk_id();
    let inner = match otel_config {
      Some(config) => aic_sdk::Vad::with_otel_config(&model.inner, &license_key, &config.into()),
      None => aic_sdk::Vad::new(&model.inner, &license_key),
    };
    Ok(Self {
      inner: map_err(inner)?,
    })
  }

  /// Configures the VAD for an audio format. Must be called before processing.
  ///
  /// The model's optimal sample rate and block size give the most frequent prediction
  /// updates. Allocates, so keep it off the audio path.
  #[napi]
  pub fn initialize(
    &mut self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> Result<()> {
    map_err(
      self
        .inner
        .initialize(&audio_config(sample_rate, block_size, variable_block_size)),
    )
  }

  /// Examines a mono audio block and updates the prediction, leaving the audio unmodified.
  #[napi]
  pub fn process(&mut self, audio: Float32Array) -> Result<()> {
    // Read-only, so the safe `Deref` to `&[f32]` is enough here. Taking the view by
    // value does not copy the caller's samples.
    map_err(self.inner.process(&audio))
  }

  /// Creates a handle for reading predictions and controlling this VAD.
  ///
  /// Each call returns an independent handle onto the same VAD.
  #[napi]
  pub fn get_context(&self) -> VadContext {
    VadContext {
      inner: self.inner.context(),
    }
  }

  /// Ends this VAD's telemetry session, after which it can no longer process audio.
  #[napi]
  pub fn terminate_session(&mut self) -> Result<()> {
    map_err(self.inner.terminate_session())
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

  /// Reads the current value of a VAD parameter.
  #[napi]
  pub fn get_parameter(&self, parameter: VadParameter) -> Result<f64> {
    map_err(self.inner.parameter(parameter.into())).map(f64::from)
  }

  /// Whether speech is currently detected.
  ///
  /// The decision lags its input by {@link VadContext#getPredictionDelay} samples, and
  /// stops updating if the backing VAD stops being processed.
  #[napi]
  pub fn is_speech_detected(&self) -> bool {
    self.inner.is_speech_detected()
  }

  /// The model's raw prediction, in the range 0.0 - 1.0.
  ///
  /// Unlike {@link VadContext#isSpeechDetected} this skips the SDK's post-processing
  /// (speech hold, sensitivity thresholding), which is useful for building your own
  /// abstractions on top. The same latency notes apply.
  #[napi]
  pub fn get_raw_vad_probability(&self) -> f64 {
    self.inner.raw_vad_probability().into()
  }

  /// How far the prediction lags its input, in samples at the initialized rate.
  ///
  /// Covers input reblocking, STFT and model processing. This delay is **not** applied to
  /// the audio (`process` leaves the buffer untouched), so use it to line speech
  /// decisions up with the audio timeline. Independent of a processor's audio delay.
  #[napi]
  pub fn get_prediction_delay(&self) -> u32 {
    self.inner.prediction_delay() as u32
  }

  /// Clears internal state, including the published prediction.
  ///
  /// Call this on a stream discontinuity or when seeking, to keep earlier audio from
  /// causing mispredictions.
  #[napi]
  pub fn reset(&self) -> Result<()> {
    map_err(self.inner.reset())
  }

  /// Swaps in a renewed JWT without interrupting processing.
  ///
  /// Only works when both the original key and the new token are JWTs. On failure the
  /// call is a no-op and the previous token stays active.
  #[napi]
  pub fn update_bearer_token(&self, token: String) -> Result<()> {
    map_err(self.inner.update_bearer_token(&token))
  }
}
