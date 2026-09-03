use crate::{
  claim_sdk_id,
  error::{Result, disposed_error, map_err},
  mem,
  model::Model,
};

use napi::{Env, bindgen_prelude::Float32Array, bindgen_prelude::ObjectFinalize};
use napi_derive::napi;

/// Enhancement parameters, all changeable while audio is being processed.
#[napi]
pub enum ProcessorParameter {
  /// Bypasses processing while preserving the algorithmic delay, so enhancement can be
  /// toggled without clicks or timing shifts.
  ///
  /// Range 0.0 - 1.0, where 0.0 is enhancement active and 1.0 is latency-compensated
  /// passthrough. Defaults to 0.0.
  Bypass = 0,
  /// Tunes enhancement strength for a given STT engine, environment or UX requirement.
  ///
  /// Quail models suppress noise more aggressively as this rises (and, with Voice Focus,
  /// competing speech too); Rook models change the mixback. Range 0.0 - 1.0.
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

/// Per-instance OpenTelemetry settings.
///
/// Overrides the environment-based defaults (e.g. `AIC_SDK_OTEL_ENABLE`) for the one
/// processor or VAD it is passed to.
#[napi(object)]
pub struct OtelConfig {
  /// Whether to export telemetry.
  pub enable: bool,
  /// Session id to report. A random one is generated when omitted.
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

/// Builds the SDK audio config shared by processors, VADs and analyzers.
///
/// Block sizes cross the JS boundary as `u32` rather than the SDK's `usize`, which napi
/// would marshal as a BigInt.
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

/// Speech enhancement processor.
///
/// Built from an enhancement or bypass model. Use {@link Vad} for dedicated VAD models
/// and {@link Analyzer} for analysis models; passing the wrong kind throws.
///
/// Create several processors to handle multiple streams or to switch models at runtime.
#[napi(custom_finalize)]
pub struct Processor {
  inner: Option<aic_sdk::Processor<'static>>,
}

impl ObjectFinalize for Processor {
  fn finalize(self, env: Env) -> Result<()> {
    // `dispose()` already gave the footprint back when the inner is gone.
    if self.inner.is_some() {
      mem::adjust(env, -mem::PROCESSOR_BYTES);
    }
    Ok(())
  }
}

#[napi]
impl Processor {
  /// Creates a processor from an enhancement or bypass model.
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
    let model_inner = model.sdk()?;
    claim_sdk_id();
    let inner = match otel_config {
      Some(config) => {
        aic_sdk::Processor::with_otel_config(model_inner, &license_key, &config.into())
      }
      None => aic_sdk::Processor::new(model_inner, &license_key),
    };
    let inner = map_err(inner)?;
    mem::adjust(env, mem::PROCESSOR_BYTES);

    Ok(Self { inner: Some(inner) })
  }

  /// Destroys the native processor immediately, releasing its memory and telemetry
  /// session without waiting for garbage collection.
  ///
  /// Every later method throws; calling `dispose()` again does nothing.
  #[napi]
  pub fn dispose(&mut self, env: Env) {
    if self.inner.take().is_some() {
      mem::adjust(env, -mem::PROCESSOR_BYTES);
    }
  }

  /// Configures the processor for an audio format. Must be called before processing.
  ///
  /// For the lowest delay use {@link Model#getOptimalSampleRate} and
  /// {@link Model#getOptimalBlockSize}. Allocates, so keep it off the audio path.
  ///
  /// With `variableBlockSize` enabled (default `false`), calls shorter than `blockSize`
  /// are permitted at the cost of extra delay; longer calls are always rejected.
  #[napi]
  pub fn initialize(
    &mut self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> Result<()> {
    let inner = self
      .inner
      .as_mut()
      .ok_or_else(|| disposed_error("Processor"))?;
    map_err(inner.initialize(&audio_config(sample_rate, block_size, variable_block_size)))
  }

  /// Enhances a mono audio block in place.
  ///
  /// The block must be exactly `blockSize` samples, or at most `blockSize` if
  /// `variableBlockSize` was enabled.
  #[napi]
  pub fn process(&mut self, mut audio: Float32Array) -> Result<()> {
    // Taken by value, which does not copy: `Float32Array` is a view holding a reference
    // to the caller's ArrayBuffer, so writes below land in the JS-owned buffer.
    //
    // SAFETY: `as_mut` is unsafe because JS could mutate the backing ArrayBuffer
    // concurrently. It cannot here: this call is synchronous, so no JS runs while the
    // slice is alive, the slice never escapes this function, and each Node thread has
    // its own isolate. A SharedArrayBuffer written by another worker mid-call would
    // break that assumption, which is inherent to processing JS-owned buffers in place.
    let samples = unsafe { audio.as_mut() };
    let inner = self
      .inner
      .as_mut()
      .ok_or_else(|| disposed_error("Processor"))?;

    map_err(inner.process(samples))
  }

  /// Creates a handle for reading and writing this processor's parameters and state.
  ///
  /// Each call returns an independent handle onto the same processor.
  #[napi]
  pub fn get_context(&self) -> Result<ProcessorContext> {
    let inner = self
      .inner
      .as_ref()
      .ok_or_else(|| disposed_error("Processor"))?;

    Ok(ProcessorContext {
      inner: inner.context(),
    })
  }

  /// Ends this processor's telemetry session, after which it can no longer process audio.
  ///
  /// Intended for lifecycle events: a session is closed automatically when the processor
  /// is collected, but GC timing is not guaranteed. May block, so keep it off the audio path.
  #[napi]
  pub fn terminate_session(&mut self) -> Result<()> {
    let inner = self
      .inner
      .as_mut()
      .ok_or_else(|| disposed_error("Processor"))?;
    map_err(inner.terminate_session())
  }
}

/// Control handle for a {@link Processor}.
///
/// Every method may be called while audio is being processed. Releasing the handle does
/// not destroy the processor it came from.
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

  /// Reads the current value of a parameter.
  #[napi]
  pub fn get_parameter(&self, parameter: ProcessorParameter) -> Result<f64> {
    map_err(self.inner.parameter(parameter.into())).map(f64::from)
  }

  /// Total delay the processor applies to the audio, in samples at the initialized rate.
  ///
  /// Covers algorithmic delay plus any buffering from a non-optimal block size. Before
  /// initialization it reports the base delay at the model's optimal settings.
  #[napi]
  pub fn get_audio_delay(&self) -> u32 {
    self.inner.audio_delay() as u32
  }

  /// Clears internal state and buffers, keeping the configured audio settings.
  ///
  /// Call this on a stream discontinuity or when seeking, to keep earlier audio from
  /// bleeding into the output.
  #[napi]
  pub fn reset(&self) -> Result<()> {
    map_err(self.inner.reset())
  }

  /// Swaps in a renewed JWT without interrupting processing.
  ///
  /// Only works when both the original key and the new token are JWTs. On failure the
  /// call is a no-op and the previous token stays active. On success the swap is applied
  /// immediately and is not gated on backend acceptance.
  #[napi]
  pub fn update_bearer_token(&self, token: String) -> Result<()> {
    map_err(self.inner.update_bearer_token(&token))
  }
}
