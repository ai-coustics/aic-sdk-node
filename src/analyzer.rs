use crate::{
  claim_sdk_id,
  disposable_slot::{DisposableSlot, lock},
  error::{Result, map_err},
  mem,
  model::Model,
  processor::audio_config,
};

use napi::{
  Env, Task,
  bindgen_prelude::ObjectFinalize,
  bindgen_prelude::{AsyncTask, Float32Array},
};
use napi_derive::napi;
use std::sync::{Arc, Mutex};

/// Results of analyzing an audio signal with {@link Analyzer}.
///
/// Scores range from 0.0 to 1.0. For every field except `speakerLoudness`, lower values
/// indicate less problematic audio.
#[napi(object)]
pub struct AnalysisResult {
  /// Predicts the likelihood of failure in downstream models, including speech-to-text,
  /// voice activity detection, turn-taking and speech-to-speech models.
  pub risk_score: f64,
  /// Measure of speaker distance and reverberation.
  pub speaker_reverb: f64,
  /// Measure of speaker loudness.
  pub speaker_loudness: f64,
  /// Measure of interfering speech from sources other than the main speaker.
  pub interfering_speech: f64,
  /// Measure of ambient or environmental noise.
  pub noise: f64,
  /// Artifacts from lossy speech codecs, e.g. a low bitrate or narrowband codec.
  pub codec_degradation: f64,
  /// Dropouts and discontinuities, e.g. from packet loss, frame erasure, jitter or CPU
  /// overload.
  pub packet_loss: f64,
}

impl From<aic_sdk::AnalysisResult> for AnalysisResult {
  fn from(result: aic_sdk::AnalysisResult) -> Self {
    Self {
      risk_score: result.risk_score.into(),
      speaker_reverb: result.speaker_reverb.into(),
      speaker_loudness: result.speaker_loudness.into(),
      interfering_speech: result.interfering_speech.into(),
      noise: result.noise.into(),
      codec_degradation: result.codec_degradation.into(),
      packet_loss: result.packet_loss.into(),
    }
  }
}

/// Analyzes audio quality using an analysis model, such as Tyto.
///
/// Call {@link Analyzer#initialize}, then {@link Analyzer#buffer} to collect mono audio.
/// The model determines how much audio is retained; older samples are discarded as new
/// audio arrives.
///
/// Run {@link Analyzer#analyzeAsync} to analyze the buffered audio on a libuv worker
/// thread, or {@link Analyzer#analyze} to run it on the calling thread. Analysis is
/// computationally expensive and should not run in audio processing callbacks.
/// Buffering remains synchronous and can continue while async analysis is running.
#[napi(custom_finalize)]
pub struct Analyzer {
  // Both SDK objects own their state and retain the memory-mapped model as needed.
  // Only the analyzer is shared with workers; collector access does not take its lock.
  collector: DisposableSlot<aic_sdk::Collector>,
  analyzer: Arc<Mutex<DisposableSlot<aic_sdk::Analyzer<'static>>>>,
}

impl ObjectFinalize for Analyzer {
  fn finalize(mut self, env: Env) -> Result<()> {
    // A pending task can retain the analyzer after this finalizer; see `DisposableSlot`.
    // The SDK permits the collector and analyzer to be destroyed independently, so the
    // collector can be released during analysis. Both releases are idempotent.
    self.collector.release(env);
    if Arc::strong_count(&self.analyzer) == 1 {
      lock(&self.analyzer).release(env);
    }
    Ok(())
  }
}

#[napi]
impl Analyzer {
  /// Creates an analyzer from an analysis model.
  ///
  /// Construction allocates memory. Call {@link Analyzer#initialize} before buffering audio.
  ///
  /// @param model - Analysis model. Other model types are rejected.
  /// @param licenseKey - SDK license key from https://developers.ai-coustics.com.
  #[napi(constructor)]
  pub fn new(env: Env, model: &Model, license_key: String) -> Result<Self> {
    let model_inner = model.inner()?;
    claim_sdk_id();
    let (collector, analyzer) = map_err(aic_sdk::analyzer_pair(model_inner, &license_key))?;

    Ok(Self {
      collector: DisposableSlot::new(env, collector, "Analyzer", mem::COLLECTOR_BYTES),
      analyzer: Arc::new(Mutex::new(DisposableSlot::new(
        env,
        analyzer,
        "Analyzer",
        mem::ANALYZER_BYTES,
      ))),
    })
  }

  /// Destroys the native collector and analyzer without waiting for garbage collection.
  ///
  /// After disposal, all methods except `dispose()` fail. Repeated disposal has no effect.
  /// This call blocks the calling thread while a worker holds the analyzer lock.
  /// Queued analysis that acquires the lock after disposal rejects its promise.
  #[napi]
  pub fn dispose(&mut self, env: Env) {
    // The SDK allows collector destruction during analysis. Releasing the analyzer
    // requires its lock and waits if a worker currently holds it.
    self.collector.release(env);
    lock(&self.analyzer).release(env);
  }

  /// Configures the analyzer's audio collector.
  ///
  /// Call this before buffering audio. Use {@link Model#getOptimalSampleRate} and
  /// {@link Model#getOptimalBlockSize} to avoid internal resampling and rebuffering.
  /// This method allocates memory; avoid calling it from audio processing callbacks.
  ///
  /// @param sampleRate - Audio sample rate in Hz.
  /// @param blockSize - Number of mono samples per block.
  /// @param variableBlockSize - Allow blocks shorter than `blockSize`. Defaults to `false`.
  ///   Blocks larger than `blockSize` are always rejected.
  #[napi]
  pub fn initialize(
    &mut self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> Result<()> {
    map_err(self.collector.get_mut()?.initialize(&audio_config(
      sample_rate,
      block_size,
      variable_block_size,
    )))
  }

  /// Buffers a mono audio block for later analysis without modifying the input.
  ///
  /// Call {@link Analyzer#initialize} first. The block must contain exactly `blockSize`
  /// samples, or at most `blockSize` if `variableBlockSize` is enabled.
  /// Buffering does not acquire the analyzer lock and can run during async analysis.
  #[napi]
  pub fn buffer(&mut self, audio: Float32Array) -> Result<()> {
    map_err(self.collector.get_mut()?.buffer(&audio))
  }

  /// Analyzes buffered audio on the calling thread and returns the scores.
  ///
  /// The model analyzes a fixed duration of audio. If less audio has been buffered, the
  /// remaining input is padded with silence.
  ///
  /// This method blocks the calling thread. Use {@link Analyzer#analyzeAsync} to keep the
  /// event loop available. For multichannel audio, mix down to mono or use one analyzer
  /// per channel.
  #[napi]
  pub fn analyze(&self) -> Result<AnalysisResult> {
    map_err(lock(&self.analyzer).get_mut()?.analyze_buffered()).map(AnalysisResult::from)
  }

  /// Analyzes buffered audio on a libuv worker thread and returns a promise for the scores.
  ///
  /// Uses the same analysis and silence padding as {@link Analyzer#analyze}.
  /// {@link Analyzer#buffer} can continue collecting audio while analysis runs.
  ///
  /// Synchronous calls to `analyze`, `reset`, `updateBearerToken`, `terminateSession` and
  /// `dispose` wait for the analyzer lock and may block while analysis is running.
  #[napi(ts_return_type = "Promise<AnalysisResult>")]
  pub fn analyze_async(&self) -> AsyncTask<AnalyzeTask> {
    AsyncTask::new(AnalyzeTask {
      analyzer: self.analyzer.clone(),
    })
  }

  /// Clears buffered audio and internal state, keeping the configured audio settings.
  #[napi]
  pub fn reset(&self) -> Result<()> {
    map_err(lock(&self.analyzer).get_mut()?.reset())
  }

  /// Replaces the bearer token on the running analyzer.
  ///
  /// Use this to refresh a JWT without recreating the instance. Both the original license
  /// key and the new token must be JWTs. If this call fails, the previous token remains active.
  ///
  /// A successful call validates the token's format and applies it immediately. Backend
  /// acceptance is checked later. If the backend rejects the token, the SDK retries with
  /// backoff; analysis may be rejected if no accepted token arrives in time.
  /// Supply a valid token to recover the session.
  ///
  /// This method allocates memory and takes a mutex. Avoid calling it from audio callbacks.
  #[napi]
  pub fn update_bearer_token(&self, token: String) -> Result<()> {
    map_err(lock(&self.analyzer).get_mut()?.update_bearer_token(&token))
  }

  /// Terminates the telemetry session associated with this analyzer.
  ///
  /// Once termination is handled, the analyzer can no longer analyze buffered audio.
  /// The session also ends when the native analyzer is destroyed. This method may block;
  /// avoid calling it from audio processing callbacks. If another session is still active,
  /// termination can complete asynchronously.
  #[napi]
  pub fn terminate_session(&self) -> Result<()> {
    map_err(lock(&self.analyzer).get_mut()?.terminate_session())
  }
}

/// Runs analysis on a worker while the collector remains accessible on the JavaScript thread.
pub struct AnalyzeTask {
  analyzer: Arc<Mutex<DisposableSlot<aic_sdk::Analyzer<'static>>>>,
}

impl Task for AnalyzeTask {
  type Output = aic_sdk::AnalysisResult;
  type JsValue = AnalysisResult;

  fn compute(&mut self) -> Result<aic_sdk::AnalysisResult> {
    map_err(lock(&self.analyzer).get_mut()?.analyze_buffered())
  }

  fn resolve(&mut self, _env: Env, result: aic_sdk::AnalysisResult) -> Result<AnalysisResult> {
    Ok(result.into())
  }
}
