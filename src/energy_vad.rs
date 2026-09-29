use crate::{
  error::{Result, map_err},
  vad::VadParameter,
};

use napi_derive::napi;

/// Control handle for a {@link Processor}'s energy-based voice activity detector.
///
/// Create one with {@link Processor#getEnergyVadContext} or
/// {@link ProcessorAsync#getEnergyVadContext}.
///
/// Detection uses the enhanced signal before output mixing, without running a separate
/// VAD model. Creating a context keeps inference active even when the processor is bypassed
/// or the enhancement level is zero. Inference remains active until the processor is
/// destroyed, even if all its energy VAD contexts are released.
///
/// All contexts created from one processor share the same detector. Every method may be
/// called while audio is being processed.
///
/// Context and processor have independent lifetimes: the context stays valid after its
/// processor is disposed or garbage-collected, but its prediction no longer updates.
/// Releasing the context does not destroy the processor or disable detection.
///
/// ```javascript
/// const processor = new Processor(model, licenseKey)
/// processor.initialize(sampleRate, blockSize)
/// const vadContext = processor.getEnergyVadContext()
/// vadContext.setParameter(VadParameter.Sensitivity, 6.0)
/// processor.process(block)
/// console.log(vadContext.isSpeechDetected())
/// ```
#[napi]
pub struct EnergyVadContext {
  pub(crate) inner: aic_sdk::EnergyVadContext,
}

#[napi]
impl EnergyVadContext {
  /// Returns whether speech is currently detected.
  ///
  /// This is `false` before processing and after {@link EnergyVadContext#reset}. The
  /// decision lags its input by {@link EnergyVadContext#getPredictionDelay} samples, and
  /// stops updating if the backing processor stops being processed.
  #[napi]
  pub fn is_speech_detected(&self) -> bool {
    self.inner.is_speech_detected()
  }

  /// Sets an energy VAD parameter. Throws if the value is out of range.
  ///
  /// {@link VadParameter.Sensitivity} uses the energy-based range, 1.0 to 15.0.
  #[napi]
  pub fn set_parameter(&self, parameter: VadParameter, value: f64) -> Result<()> {
    map_err(self.inner.set_parameter(parameter.into(), value as f32))
  }

  /// Returns the current value of an energy VAD parameter.
  #[napi]
  pub fn get_parameter(&self, parameter: VadParameter) -> f64 {
    self.inner.parameter(parameter.into()).into()
  }

  /// Returns the prediction delay in samples at the configured sample rate.
  ///
  /// Includes input buffering, STFT and model processing, and equals the processor's
  /// {@link ProcessorContext#getAudioDelay}. Energy detection adds no audio delay.
  /// Speech hold and minimum speech duration also affect decision timing but are not
  /// included in this value.
  ///
  /// Before initialization it reports the base delay at the model's optimal settings.
  /// Non-optimal or variable block sizes can add buffering latency. Convert to
  /// milliseconds with `delaySamples * 1000 / sampleRate`.
  #[napi]
  pub fn get_prediction_delay(&self) -> u32 {
    self.inner.prediction_delay() as u32
  }

  /// Clears the energy VAD state, including the published speech decision.
  ///
  /// Call this when the stream is interrupted or when seeking to prevent predictions
  /// from using previous audio. Parameters are retained and the processor is not reset.
  /// {@link ProcessorContext#reset} also resets the energy VAD.
  #[napi]
  pub fn reset(&self) {
    self.inner.reset()
  }
}
