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

/// Scores produced by {@link Analyzer#analyze}.
///
/// Every score runs 0.0 - 1.0. For all of them except `speakerLoudness`, lower means less
/// problematic audio.
#[napi(object)]
pub struct AnalysisResult {
  /// Headline score: how likely this audio is to break downstream models such as
  /// speech-to-text, VAD, turn-taking or speech-to-speech.
  pub risk_score: f64,
  /// How distant and reverberant the speaker sounds.
  pub speaker_reverb: f64,
  /// How loud the speaker is.
  pub speaker_loudness: f64,
  /// How much speech from people other than the main speaker is present.
  pub interfering_speech: f64,
  /// How much ambient or environmental noise is present.
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

/// Analyzer for analysis models such as Tyto.
///
/// Buffering and analysis are deliberately separate calls: {@link Analyzer#buffer} is cheap
/// enough for the audio path, while running the model is not. Analysis therefore comes in
/// two forms: {@link Analyzer#analyzeAsync} on a worker thread, and
/// {@link Analyzer#analyze} on the calling thread.
///
/// Only a fixed span of audio is retained, determined by the model; older audio is
/// discarded as more is buffered.
///
/// The SDK splits this into a collector and an analyzer so the two halves can live on
/// different threads. A class instance cannot cross into a Node worker, so both are exposed
/// as one object here, but the split still shows through: {@link Analyzer#buffer} drives
/// the collector on the calling thread, while {@link Analyzer#analyzeAsync} moves the
/// analyzer half onto a worker. The SDK guarantees the two are safe to use concurrently.
#[napi(custom_finalize)]
pub struct Analyzer {
  // Neither half borrows the other, nor the model: `'static` here is the model weights'
  // lifetime, which `Model.fromFile` satisfies by memory-mapping the file.
  //
  // Only the analyzer half is shared. The collector is owned outright, so `buffer`, the
  // one call on the audio path, takes no lock and cannot contend with an analysis running
  // on a worker thread.
  collector: DisposableSlot<aic_sdk::Collector>,
  analyzer: Arc<Mutex<DisposableSlot<aic_sdk::Analyzer<'static>>>>,
}

impl ObjectFinalize for Analyzer {
  fn finalize(mut self, env: Env) -> Result<()> {
    // Each half is released on its own, and each release is a no-op when `dispose()`
    // got there first.
    //
    // An in-flight `AnalyzeTask` holds the analyzer `Arc`, so that half is dropped
    // only after the worker finishes, and its footprint is left for whoever holds the
    // last handle. The collector drops here, possibly while the worker analyzes. That
    // is safe per the C API, which destroys the paired halves independently, in any
    // order (`aic_collector_destroy`).
    self.collector.release(env);
    if Arc::strong_count(&self.analyzer) == 1 {
      lock(&self.analyzer).release(env);
    }
    Ok(())
  }
}

#[napi]
impl Analyzer {
  /// Creates an analyzer from an analysis model. Other model types are rejected.
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

  /// Destroys the native collector and analyzer immediately, releasing their memory
  /// without waiting for garbage collection.
  ///
  /// Every later method throws; calling `dispose()` again does nothing. Blocks until an
  /// in-flight `analyzeAsync` on a worker thread finishes.
  #[napi]
  pub fn dispose(&mut self, env: Env) {
    // The collector is released before the analyzer lock is taken, so it can be
    // destroyed while an `analyzeAsync` is in flight on a worker. That is safe per the
    // C API (`aic_collector_destroy`): the paired halves are destroyed independently, in
    // any order, and the collector handle itself is only ever used on this thread. The
    // analyzer half is destroyed under the lock, which is what blocks until the
    // in-flight analysis finishes.
    //
    // Both releases are idempotent, so a second `dispose()` does nothing.
    self.collector.release(env);
    lock(&self.analyzer).release(env);
  }

  /// Configures the analyzer for an audio format. Must be called before buffering.
  ///
  /// The model's optimal sample rate and block size avoid internal resampling and
  /// rebuffering. Allocates, so keep it off the audio path.
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

  /// Buffers a mono audio block for later analysis, leaving the audio unmodified.
  #[napi]
  pub fn buffer(&mut self, audio: Float32Array) -> Result<()> {
    map_err(self.collector.get_mut()?.buffer(&audio))
  }

  /// Runs the analysis model over the buffered audio, on the calling thread.
  ///
  /// The model consumes a fixed span of audio. Calling this before that much has been
  /// buffered analyzes what is there, padded with silence.
  ///
  /// Analysis is mono. Mix multichannel audio down, or use one analyzer per channel.
  ///
  /// This is the expensive call, and it blocks. Prefer {@link Analyzer#analyzeAsync} unless
  /// nothing else is waiting on the event loop.
  #[napi]
  pub fn analyze(&self) -> Result<AnalysisResult> {
    map_err(lock(&self.analyzer).get_mut()?.analyze_buffered()).map(AnalysisResult::from)
  }

  /// Runs the analysis model over the buffered audio on a worker thread.
  ///
  /// Same result as {@link Analyzer#analyze}, off the event loop. The SDK's
  /// analysis models are too expensive to run on an audio thread, so this is the form to
  /// reach for in a server: analysis is occasional, and a promise costs nothing next to
  /// the model.
  ///
  /// {@link Analyzer#buffer} stays synchronous and takes no lock, so audio can keep arriving
  /// while an analysis is in flight. The SDK guarantees the collector and analyzer halves
  /// are safe to use concurrently. The other methods here do take the analyzer's lock, so
  /// calling {@link Analyzer#analyze}, {@link Analyzer#reset} or
  /// {@link Analyzer#terminateSession} while this is pending blocks the calling thread until
  /// it finishes.
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

  /// Swaps in a renewed JWT without tearing down the analyzer.
  ///
  /// Only works when both the original key and the new token are JWTs. On failure the
  /// call is a no-op and the previous token stays active.
  #[napi]
  pub fn update_bearer_token(&self, token: String) -> Result<()> {
    map_err(lock(&self.analyzer).get_mut()?.update_bearer_token(&token))
  }

  /// Ends this analyzer's telemetry session, after which it can no longer analyze audio.
  #[napi]
  pub fn terminate_session(&self) -> Result<()> {
    map_err(lock(&self.analyzer).get_mut()?.terminate_session())
  }
}

/// Backs {@link Analyzer#analyzeAsync}.
///
/// Holds only the analyzer half, so the collector stays on the JS thread where `buffer` can
/// keep reaching it while this runs.
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
