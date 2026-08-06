// Platform-specific binary loader
let native;
try {
  const platform = process.platform;
  const arch = process.arch;

  const platformPackages = {
    "linux-x64": "@ai-coustics/aic-sdk-linux-x64-gnu",
    "linux-arm64": "@ai-coustics/aic-sdk-linux-arm64-gnu",
    "darwin-x64": "@ai-coustics/aic-sdk-darwin-x64",
    "darwin-arm64": "@ai-coustics/aic-sdk-darwin-arm64",
    "win32-x64": "@ai-coustics/aic-sdk-win32-x64-msvc",
    "win32-arm64": "@ai-coustics/aic-sdk-win32-arm64-msvc",
  };

  const platformKey = `${platform}-${arch}`;
  const platformPackage = platformPackages[platformKey];

  if (platformPackage) {
    try {
      native = require(platformPackage);
    } catch (e) {
      native = require("./index.node");
    }
  } else {
    native = require("./index.node");
  }
} catch (e) {
  throw new Error(
    `Failed to load native binary for platform ${process.platform}-${process.arch}. ` +
      `Supported platforms: Linux (x64/ARM64, GNU libc), macOS (x64/ARM64), Windows (x64/ARM64, MSVC). ` +
      `Error: ${e.message}`,
  );
}

/**
 * Configurable parameters for audio enhancement.
 * @enum {number}
 */
const ProcessorParameter = {
  /**
   * Controls whether audio processing is bypassed while preserving algorithmic delay.
   *
   * When enabled, the input audio passes through unmodified, but the output is still
   * delayed by the same amount as during normal processing. This ensures seamless
   * transitions when toggling enhancement on/off without audible clicks or timing shifts.
   *
   * Range: 0.0 to 1.0
   *   - 0.0: Enhancement active (normal processing)
   *   - 1.0: Bypass enabled (latency-compensated passthrough)
   *
   * Default: 0.0
   */
  Bypass: native.PROCESSOR_PARAM_BYPASS,

  /**
   * A tunable parameter to optimize for specific STT engines, deployment environments, and user experience requirements.
   *
   * The exact behavior depends on the active model:
   *
   * - Quail Models: Controls how aggressively the model suppresses noise. When used with Quail Voice Focus, it also suppresses background and competing speech.
   * - Sparrow Models: Controls the mixback and therefore the intensity of the enhancement.
   *
   * Range: 0.0 to 1.0
   */
  EnhancementLevel: native.PROCESSOR_PARAM_ENHANCEMENT_LEVEL,
};

/**
 * Configurable parameters for Voice Activity Detection.
 * @enum {number}
 */
const VadParameter = {
  /**
   * Controls for how long the VAD continues to detect speech after the audio signal
   * no longer contains speech.
   *
   * This affects the stability of speech detected -> not detected transitions.
   *
   * The VAD reports speech detected if the audio signal contained speech in at least 50%
   * of the blocks processed in the last `speech_hold_duration * 2` seconds.
   *
   * For example, if `speech_hold_duration` is set to 0.5 seconds and the VAD stops detecting speech
   * in the audio signal, the VAD will continue to report speech for 0.5 seconds assuming the
   * VAD does not detect speech again during that period. If a few blocks of speech are detected
   * during that period, those blocks will be included in the 50% calculation, which will extend
   * the speech detection period until the 50% threshold is no longer met.
   *
   * NOTE: The VAD returns a value per processed audio block, so this duration is rounded
   * to the closest model window length. For example, if the model has a processing window
   * length of 10 ms, the VAD will round up/down to the closest multiple of 10 ms.
   * Because of this, this parameter may return a different value than the one it was last set to.
   *
   * **Range:** 0.0 to 300x model window length (value in seconds)
   *
   * **Default:** 0.03 (30 ms)
   */
  SpeechHoldDuration: native.VAD_PARAM_SPEECH_HOLD_DURATION,

  /**
   * Controls the sensitivity of the VAD.
   *
   * VAD models output a probability of speech presence for each processed audio block,
   * where 1.0 means the model is certain speech is present and 0.0 means it is certain
   * speech is not present. A value above this threshold triggers a speech decision.
   *
   * Range: 0.0 to 1.0
   * Default: model-specific.
   */
  Sensitivity: native.VAD_PARAM_SENSITIVITY,

  /**
   * Controls for how long speech needs to be present in the audio signal before
   * the VAD considers it speech.
   *
   * This affects the stability of speech not detected -> detected transitions.
   *
   * NOTE: The VAD returns a value per processed audio block, so this duration is rounded
   * to the closest model window length.
   *
   * Range: 0.0 to 1.0 (value in seconds)
   * Default: 0.0
   */
  MinimumSpeechDuration: native.VAD_PARAM_MINIMUM_SPEECH_DURATION,
};

/**
 * Context for managing processor state and parameters.
 * Created via {@link Processor#getContext}.
 */
class ProcessorContext {
  constructor(nativeContext) {
    this._context = nativeContext;
  }

  /**
   * Clears all internal processing state, including any internally stored audio samples.
   *
   * Call this when the audio stream is interrupted or when seeking
   * to prevent artifacts from previous audio content.
   *
   * The processor stays initialized to the configured settings. VAD state is separate and
   * must be reset through {@link VadContext#reset}.
   *
   * Thread Safety: Real-time safe. Can be called from audio processing threads.
   */
  reset() {
    native.processorContextReset(this._context);
  }

  /**
   * Modifies a processor parameter.
   *
   * All parameters can be changed during audio processing.
   * This function can be called from any thread.
   *
   * @param {ProcessorParameter} parameter - Parameter to modify
   * @param {number} value - New parameter value. See parameter documentation for ranges
   * @throws {Error} If the parameter value is out of range.
   *
   * @example
   * processorContext.setParameter(ProcessorParameter.EnhancementLevel, 0.8);
   */
  setParameter(parameter, value) {
    native.processorContextSetParameter(this._context, parameter, value);
  }

  /**
   * Retrieves the current value of a parameter.
   *
   * This function can be called from any thread.
   *
   * @param {ProcessorParameter} parameter - Parameter to query
   * @returns {number} The current parameter value.
   *
   * @example
   * const level = processorContext.getParameter(ProcessorParameter.EnhancementLevel);
   */
  getParameter(parameter) {
    return native.processorContextGetParameter(this._context, parameter);
  }

  /**
   * Returns the total output delay in samples for the current audio configuration.
   *
   * This function provides the complete end-to-end latency introduced by the model,
   * which includes both algorithmic processing delay and any internal block-adaptation delay.
   * Use this value to synchronize enhanced audio with other streams or to implement
   * delay compensation in your application.
   *
   * Delay behavior:
   *   - Before initialization: Returns the base processing delay using the model's
   *     optimal block size at its native sample rate
   *   - After initialization: Returns the actual delay for your specific configuration,
   *     including any additional block-adaptation delay from a non-optimal block size
   *
   * Important: The delay value is always expressed in samples at the sample rate
   * you configured during initialize(). To convert to time units:
   * delay_ms = (delay_samples * 1000) / sample_rate
   *
   * Note: Using a block size different from the optimal value returned by
   * Model.getOptimalBlockSize() will increase the delay beyond the model's base latency.
   *
   * @returns {number} The delay in samples.
   *
   * @example
   * const delay = processorContext.getOutputDelay();
   * console.log(`Output delay: ${delay} samples`);
   */
  getOutputDelay() {
    return native.processorContextGetOutputDelay(this._context);
  }

  /**
   * Swaps in a renewed JWT bearer token while audio processing continues
   * uninterrupted.
   *
   * Only valid when the processor was created with a JWT license. If either the
   * originally configured key or the new token is not a JWT, an error is thrown
   * and the existing token stays in use.
   *
   * This function can be called from any thread.
   *
   * @param {string} token - The renewed JWT bearer token.
   * @throws {Error} If token update is unsupported for the configured license.
   *
   * @example
   * processorContext.updateBearerToken(renewedJwt);
   */
  updateBearerToken(token) {
    native.processorContextUpdateBearerToken(this._context, token);
  }
}

/**
 * Thread-safe control handle for a {@link Vad}.
 *
 * Created via {@link Vad#getContext}. All contexts created from one VAD reference the same
 * detector instance.
 */
class VadContext {
  constructor(nativeContext) {
    this._context = nativeContext;
  }

  /**
   * Clears all internal detection state, including internally stored audio samples, the
   * published speech decision, and the raw probability. The VAD stays initialized.
   *
   * Call this when the audio stream is interrupted or when seeking.
   *
   * @throws {Error} If the reset fails.
   */
  reset() {
    native.vadContextReset(this._context);
  }

  /**
   * Returns the VAD's current prediction.
   *
   * The prediction lags its input by the number of samples returned by
   * {@link VadContext#getOutputDelay}. If the backing VAD stops being processed, the
   * prediction does not update.
   *
   * @returns {boolean} True if speech is detected, false otherwise.
   */
  isSpeechDetected() {
    return native.vadContextIsSpeechDetected(this._context);
  }

  /**
   * Returns the VAD model's raw speech probability without SDK post-processing such as
   * sensitivity thresholding or speech hold duration.
   *
   * @returns {number} The raw VAD probability in the range 0.0 to 1.0.
   */
  rawVadProbability() {
    return native.vadContextRawVadProbability(this._context);
  }

  /**
   * Modifies a VAD parameter. Parameters can be changed while audio is processed.
   *
   * @param {VadParameter} parameter - Parameter to modify
   * @param {number} value - New parameter value. See parameter documentation for ranges
   * @throws {Error} If the parameter value is out of range.
   *
   * @example
   * vadContext.setParameter(VadParameter.SpeechHoldDuration, 0.08);
   * vadContext.setParameter(VadParameter.Sensitivity, 0.5);
   */
  setParameter(parameter, value) {
    native.vadContextSetParameter(this._context, parameter, value);
  }

  /**
   * Retrieves the current value of a VAD parameter.
   *
   * @param {VadParameter} parameter - Parameter to query
   * @returns {number} The current parameter value.
   */
  getParameter(parameter) {
    return native.vadContextGetParameter(this._context, parameter);
  }

  /**
   * Returns the end-to-end VAD prediction delay in samples.
   *
   * After initialization, this includes input reblocking and model processing latency at
   * the configured sample rate. Use it to align VAD decisions with the input timeline.
   *
   * @returns {number} The prediction delay in samples.
   */
  getOutputDelay() {
    return native.vadContextGetOutputDelay(this._context);
  }

  /**
   * Swaps in a renewed JWT bearer token while VAD processing continues uninterrupted.
   *
   * @param {string} token - The renewed JWT bearer token.
   * @throws {Error} If token update is unsupported for the configured license.
   */
  updateBearerToken(token) {
    native.vadContextUpdateBearerToken(this._context, token);
  }
}

/**
 * The result of analyzing an audio signal with an {@link Analyzer} or {@link FileAnalyzer}.
 *
 * Scores are in the range 0.0 to 1.0. For all fields except speakerLoudness,
 * lower values indicate less problematic audio.
 *
 * @typedef {Object} AnalysisResult
 * @property {number} riskScore - Headline audio score. Predicts likelihood of failure of
 *   downstream models including speech-to-text, voice activity detection, turn-taking or
 *   speech-to-speech models. Lower indicates less problematic audio. Range: 0.0 to 1.0.
 * @property {number} speakerReverb - Measure of speaker distance and reverberance.
 *   Lower indicates less problematic audio. Range: 0.0 to 1.0.
 * @property {number} speakerLoudness - Measure of speaker loudness. Range: 0.0 to 1.0.
 * @property {number} interferingSpeech - Measure of interference from additional speakers
 *   present in audio. Lower indicates less problematic audio. Range: 0.0 to 1.0.
 * @property {number} mediaSpeech - Measure of interfering speech content from media devices,
 *   e.g. from TVs, radios or phones. Lower indicates less problematic audio. Range: 0.0 to 1.0.
 * @property {number} noise - Measure of ambient or environmental noise.
 *   Lower indicates less problematic audio. Range: 0.0 to 1.0.
 * @property {number} packetLoss - Measure of audio dropouts or discontinuities in the stream,
 *   e.g. from packet loss, frame erasure, jitter or CPU overload.
 *   Lower indicates less problematic audio. Range: 0.0 to 1.0.
 */

/**
 * Collects audio blocks for later analysis by an {@link Analyzer}.
 *
 * Pass one mono audio block at a time to the collector (for example on an audio thread). The
 * Analyzer analyzes the collected audio later.
 *
 * Created via {@link analyzerPair}.
 */
class Collector {
  constructor(nativeCollector) {
    this._collector = nativeCollector;
  }

  /**
   * Configures the collector for specific audio settings.
   *
   * This must be called before passing audio blocks to the collector. To avoid internal
   * resampling and block adaptation, use the sample rate and block size returned by
   * Model.getOptimalSampleRate() and Model.getOptimalBlockSize().
   *
   * Warning: Do not call from audio processing threads as this allocates memory.
   *
   * @param {number} sampleRate - Sample rate in Hz
   * @param {number} blockSize - Maximum samples in each audio block passed to buffer()
   * @param {boolean} [variableBlockSize=false] - Allow variable block sizes (adds latency)
   * @throws {Error} If the audio configuration is unsupported.
   */
  initialize(sampleRate, blockSize, variableBlockSize = false) {
    native.collectorInitialize(
      this._collector,
      sampleRate,
      blockSize,
      variableBlockSize,
    );
  }

  /**
   * Adds one mono audio block to the collector.
   *
   * @param {Float32Array} samples - Mono audio block of size blockSize
   * @throws {Error} If collection fails (collector not initialized, invalid block size, etc.)
   */
  buffer(samples) {
    native.collectorBuffer(this._collector, samples);
  }
}

/**
 * Runs an analysis model over the audio collected by a {@link Collector}.
 *
 * Analysis models are computationally expensive and should be run off the audio thread.
 *
 * Created via {@link analyzerPair}.
 */
class Analyzer {
  constructor(nativeAnalyzer) {
    this._analyzer = nativeAnalyzer;
  }

  /**
   * Clears the analyzer state and all audio collected by its collector.
   *
   * Call this when the audio stream is interrupted or when seeking to prevent mispredictions
   * from previous audio content. The collector stays initialized to the configured settings.
   *
   * Thread Safety: Real-time safe. Can be called from audio processing threads.
   *
   * @throws {Error} If the reset fails.
   */
  reset() {
    native.analyzerReset(this._analyzer);
  }

  /**
   * Analyzes the collected signal.
   *
   * Runs a forward pass of the analysis model over a fixed length of audio, determined by the
   * model. If called before the collector has collected that length of audio, the tail of the
   * input is analyzed as silence (zeros).
   *
   * Note: This function is not real-time safe. Avoid calling it from audio threads.
   *
   * @returns {AnalysisResult} The analysis result.
   * @throws {Error} If analysis fails.
   */
  analyzeBuffered() {
    return native.analyzerAnalyzeBuffered(this._analyzer);
  }

  /**
   * Terminates this analyzer's telemetry session before the analyzer is destroyed.
   *
   * After this call, the analyzer can no longer analyze collected audio. This operation may
   * block and should not be called from an audio thread.
   *
   * @throws {Error} If session termination cannot be requested.
   */
  terminateSession() {
    native.analyzerTerminateSession(this._analyzer);
  }

  /**
   * Swaps in a renewed JWT bearer token while analysis continues uninterrupted.
   *
   * Only valid when the analyzer was created with a JWT license. If either the originally
   * configured key or the new token is not a JWT, an error is thrown and the existing token
   * stays in use.
   *
   * @param {string} token - The renewed JWT bearer token.
   * @throws {Error} If token update is unsupported for the configured license.
   */
  updateBearerToken(token) {
    native.analyzerUpdateBearerToken(this._analyzer, token);
  }
}

/**
 * Creates a collector/analyzer pair for non-real-time analysis.
 *
 * Pass audio blocks to the {@link Collector} (for example on an audio thread), then use the
 * {@link Analyzer} to analyze the collected audio later, off the audio thread. The collector
 * retains a span of audio determined by the analysis model; as more samples are collected,
 * old audio is discarded.
 *
 * For analyzing a complete mono signal already in memory, prefer {@link FileAnalyzer}.
 *
 * @param {Model} model - The loaded model instance
 * @param {string} licenseKey - License key for the ai-coustics SDK
 *   (generate your key at https://developers.ai-coustics.com/)
 * @returns {{ collector: Collector, analyzer: Analyzer }} The collector/analyzer pair.
 * @throws {Error} If the pair cannot be created.
 *
 * @example
 * const { collector, analyzer } = analyzerPair(model, licenseKey);
 * const sampleRate = model.getOptimalSampleRate();
 * const blockSize = model.getOptimalBlockSize(sampleRate);
 * collector.initialize(sampleRate, blockSize, false);
 */
function analyzerPair(model, licenseKey) {
  const pair = native.analyzerPair(model._model, licenseKey);
  return {
    collector: new Collector(pair.collector),
    analyzer: new Analyzer(pair.analyzer),
  };
}

/**
 * Analyzes complete mono audio signals.
 *
 * FileAnalyzer is a convenience wrapper around a {@link Collector} and {@link Analyzer} pair
 * for non-real-time analysis of audio that is already loaded in memory. The windowing,
 * zero-padding and reset logic is performed by the underlying SDK.
 *
 * Each call to analyze() configures the analyzer for mono input with the model's optimal block
 * size. It analyzes independent five-second windows, advancing the start of each window by
 * stepSamples.
 *
 * For streaming analysis, use {@link analyzerPair} directly.
 *
 * @example
 * const analyzer = new FileAnalyzer(model, licenseKey);
 * const sampleRate = 16000;
 * const audio = new Float32Array(8000);
 * const results = analyzer.analyze(audio, sampleRate);
 */
class FileAnalyzer {
  /**
   * Creates a new file analyzer.
   *
   * @param {Model} model - The loaded model instance
   * @param {string} licenseKey - License key for the ai-coustics SDK
   *   (generate your key at https://developers.ai-coustics.com/)
   * @throws {Error} If the analyzer cannot be created.
   */
  constructor(model, licenseKey) {
    // Keep a reference to the model so it stays alive for the analyzer's lifetime: the native
    // analyzer borrows the model's weights and must not outlive the model.
    this._model = model;
    this._analyzer = native.fileAnalyzerNew(model._model, licenseKey);
  }

  /**
   * Analyzes a complete mono audio signal held in memory.
   *
   * The input must contain mono f32 samples at sampleRate. No channel mixing or resampling is
   * performed.
   *
   * The analyzer evaluates five-second windows. FileAnalyzer analyzes a window starting at sample
   * 0, then repeats with a window starting stepSamples later.
   *
   * If audio is shorter than or equal to five seconds, it is padded with silence and only one
   * result is returned. For longer signals, only complete five-second windows are analyzed after
   * the first window.
   *
   * Note: This function is not real-time safe. Avoid calling it from audio threads.
   *
   * @param {Float32Array} audio - Mono audio samples to analyze
   * @param {number} sampleRate - Sample rate of audio in Hz
   * @param {number|null} [stepSamples=null] - Number of samples to advance between analysis
   *   results. Defaults to the analysis window size (no overlap) when null.
   * @returns {AnalysisResult[]} A list of analysis results.
   * @throws {Error} If analysis fails.
   */
  analyze(audio, sampleRate, stepSamples = null) {
    if (!(audio instanceof Float32Array)) {
      audio = Float32Array.from(audio);
    }

    if (!(sampleRate > 0)) {
      throw new Error("sampleRate must be greater than 0");
    }

    if (stepSamples != null && !(stepSamples > 0)) {
      throw new Error("stepSamples must be greater than 0");
    }

    return native.fileAnalyzerAnalyze(
      this._analyzer,
      audio,
      sampleRate,
      stepSamples,
    );
  }
}

/**
 * OpenTelemetry configuration for a {@link Processor} or {@link Vad}.
 *
 * Pass an instance as the third constructor argument to override AIC_SDK_OTEL_ENABLE for
 * that processor or VAD only.
 */
class OtelConfig {
  /**
   * Creates an OpenTelemetry configuration for a processor or VAD.
   *
   * Pass an instance as the third constructor argument to override AIC_SDK_OTEL_ENABLE for
   * that processor or VAD only.
   *
   * @param {boolean} enable - Whether OpenTelemetry telemetry is enabled
   * @param {string|null} [sessionId=null] - Optional telemetry session ID
   * @param {number} [exportIntervalMs=0] - Metric export interval in milliseconds.
   *   Set to 0 to use the SDK default of 60000 ms.
   */
  constructor(enable, sessionId = null, exportIntervalMs = 0) {
    this.enable = Boolean(enable);
    this.sessionId = sessionId == null ? null : String(sessionId);
    this.exportIntervalMs = Number(exportIntervalMs) || 0;
  }

  /**
   * Creates a config with OpenTelemetry disabled.
   *
   * @returns {OtelConfig}
   */
  static disabled() {
    return new OtelConfig(false);
  }

  /**
   * Creates a config with OpenTelemetry enabled and a generated session ID.
   *
   * @returns {OtelConfig}
   */
  static enabled() {
    return new OtelConfig(true);
  }

  /**
   * Creates a config with OpenTelemetry enabled and the provided session ID.
   *
   * @param {string} sessionId - Telemetry session ID
   * @returns {OtelConfig}
   */
  static withSessionId(sessionId) {
    return new OtelConfig(true, sessionId);
  }
}

/**
 * High-level wrapper for an ai-coustics model.
 *
 * This class provides a safe, JavaScript-friendly interface to the underlying native library.
 * It handles memory management automatically.
 *
 * @example
 * const model = Model.fromFile("/path/to/model.aicmodel");
 * const processor = new Processor(model, licenseKey);
 * const sampleRate = model.getOptimalSampleRate();
 * processor.initialize(sampleRate, model.getOptimalBlockSize(sampleRate), false);
 */
class Model {
  constructor(nativeModel) {
    this._model = nativeModel;
  }

  /**
   * Creates a new model instance from a file.
   *
   * A model can be used to create multiple processors, VADs, or analyzers according to
   * its model type.
   *
   * @param {string} path - Path to the model file (.aicmodel). You can download models manually
   *   from https://artifacts.ai-coustics.io or use Model.download() to fetch them programmatically.
   * @returns {Model} A new Model instance.
   * @throws {Error} If model creation fails.
   *
   * @see https://artifacts.ai-coustics.io for available model IDs and downloads.
   *
   * @example
   * const model = Model.fromFile("/path/to/model.aicmodel");
   */
  static fromFile(path) {
    const nativeModel = native.modelFromFile(path);
    return new Model(nativeModel);
  }

  /**
   * Downloads a model file from the ai-coustics artifact CDN.
   *
   * This method fetches the model manifest, checks whether the requested model
   * exists in a version compatible with this library, and downloads the model
   * file into the provided directory.
   *
   * Note: This is a blocking operation.
   *
   * @param {string} modelId - The model identifier as listed in the manifest (e.g. "sparrow-l-16khz").
   *   Find available model IDs at https://artifacts.ai-coustics.io
   * @param {string} downloadDir - Directory where the downloaded model file should be stored
   * @returns {string} The full path to the downloaded model file.
   * @throws {Error} If the download operation fails.
   *
   * @see https://artifacts.ai-coustics.io for available model IDs.
   *
   * @example
   * const path = Model.download("sparrow-l-16khz", "/tmp/models");
   * const model = Model.fromFile(path);
   */
  static download(modelId, downloadDir) {
    return native.modelDownload(modelId, downloadDir);
  }

  /**
   * Returns the model identifier string.
   *
   * @returns {string} The model ID string.
   */
  getId() {
    return native.modelId(this._model);
  }

  /**
   * Retrieves the native sample rate of the model.
   *
   * Each model is optimized for a specific sample rate. Using that rate avoids internal
   * resampling and provides the model's intended frequency range and behavior. Other supported
   * sample rates can still be configured when needed.
   *
   * @returns {number} The model's native sample rate in Hz.
   *
   * @example
   * const optimalRate = model.getOptimalSampleRate();
   * console.log(`Optimal sample rate: ${optimalRate} Hz`);
   */
  getOptimalSampleRate() {
    return native.modelGetOptimalSampleRate(this._model);
  }

  /**
   * Retrieves the optimal block size for the model at a given sample rate.
   *
   * Using the optimal block size minimizes latency by avoiding internal block adaptation. The
   * optimal size varies with sample rate because each model operates on a fixed time window.
   *
   * Call this before initializing a Processor, Vad, or Collector to determine the best
   * block size for minimal latency.
   *
   * @param {number} sampleRate - Sample rate in Hz
   * @returns {number} The optimal block size in samples.
   *
   * @example
   * const sampleRate = model.getOptimalSampleRate();
   * const blockSize = model.getOptimalBlockSize(sampleRate);
   */
  getOptimalBlockSize(sampleRate) {
    return native.modelGetOptimalBlockSize(this._model, sampleRate);
  }
}

/**
 * High-level wrapper for ai-coustics audio enhancement.
 *
 * A Processor accepts enhancement and bypass models. Use {@link Vad} with a dedicated VAD
 * model for voice activity detection.
 *
 * @example
 * const model = Model.fromFile("/path/to/model.aicmodel");
 * const processor = new Processor(model, licenseKey);
 * const sampleRate = model.getOptimalSampleRate();
 * const blockSize = model.getOptimalBlockSize(sampleRate);
 * processor.initialize(sampleRate, blockSize, false);
 * const audio = new Float32Array(blockSize);
 * processor.process(audio);
 */
class Processor {
  /**
   * Creates an audio enhancement processor from an enhancement or bypass model.
   *
   * @param {Model} model - Enhancement or bypass model
   * @param {string} licenseKey - License key for the ai-coustics SDK
   *   (generate your key at https://developers.ai-coustics.com/)
   * @param {OtelConfig|null} [otelConfig=null] - Optional per-processor OpenTelemetry config.
   * @throws {Error} If creation fails or the model type is unsupported.
   */
  constructor(model, licenseKey, otelConfig = null) {
    this._processor = native.processorNew(model._model, licenseKey, otelConfig);
  }

  /**
   * Configures the processor for specific audio settings.
   *
   * For the lowest delay, use the model's optimal sample rate and block size.
   * Do not call this from an audio processing thread because it allocates memory.
   *
   * @param {number} sampleRate - Sample rate in Hz (8000 - 192000)
   * @param {number} blockSize - Samples provided to each processing call
   * @param {boolean} [variableBlockSize=false] - Allow variable block sizes (adds latency)
   * @throws {Error} If the audio configuration is unsupported.
   */
  initialize(sampleRate, blockSize, variableBlockSize = false) {
    native.processorInitialize(
      this._processor,
      sampleRate,
      blockSize,
      variableBlockSize,
    );
  }

  /**
   * Enhances a mono audio block in-place.
   *
   * @param {Float32Array} samples - Mono audio block of size blockSize
   * @throws {Error} If processing fails.
   */
  process(samples) {
    native.processorProcess(this._processor, samples);
  }

  /**
   * Creates a context for controlling processor parameters and state.
   *
   * @returns {ProcessorContext} A new context for this processor.
   */
  getContext() {
    return new ProcessorContext(native.processorGetContext(this._processor));
  }

  /**
   * Terminates this processor's telemetry session before the processor is destroyed.
   *
   * After this call, the processor can no longer process audio. This operation may block
   * and should not be called from an audio thread.
   *
   * @throws {Error} If session termination cannot be requested.
   */
  terminateSession() {
    native.processorTerminateSession(this._processor);
  }
}

/**
 * High-level wrapper for ai-coustics voice activity detection.
 *
 * A Vad is created from a dedicated VAD model such as `vad-2.1-xxs-16khz`.
 * Enhancement models are not supported; use {@link Processor} for those.
 *
 * @example
 * const model = Model.fromFile("/path/to/vad-model.aicmodel");
 * const vad = new Vad(model, licenseKey);
 * const sampleRate = model.getOptimalSampleRate();
 * const blockSize = model.getOptimalBlockSize(sampleRate);
 * vad.initialize(sampleRate, blockSize);
 * const vadContext = vad.getContext();
 * vad.process(new Float32Array(blockSize));
 * console.log(vadContext.isSpeechDetected());
 */
class Vad {
  /**
   * Creates a voice activity detector from a dedicated VAD model.
   *
   * @param {Model} model - Dedicated VAD model
   * @param {string} licenseKey - License key for the ai-coustics SDK
   * @param {OtelConfig|null} [otelConfig=null] - Optional per-VAD OpenTelemetry config.
   * @throws {Error} If creation fails or the model type is unsupported.
   */
  constructor(model, licenseKey, otelConfig = null) {
    this._vad = native.vadNew(model._model, licenseKey, otelConfig);
  }

  /**
   * Configures the VAD for specific audio settings.
   *
   * @param {number} sampleRate - Sample rate in Hz (8000 - 192000)
   * @param {number} blockSize - Samples provided to each processing call
   * @param {boolean} [variableBlockSize=false] - Allow variable block sizes (adds latency)
   * @throws {Error} If the audio configuration is unsupported.
   */
  initialize(sampleRate, blockSize, variableBlockSize = false) {
    native.vadInitialize(
      this._vad,
      sampleRate,
      blockSize,
      variableBlockSize,
    );
  }

  /**
   * Processes mono audio and updates the VAD prediction.
   *
   * This method does not modify the input audio buffer, it only reads from it. Read the
   * prediction through a {@link VadContext}.
   *
   * @param {Float32Array} samples - Mono audio block of size blockSize
   * @throws {Error} If processing fails.
   */
  process(samples) {
    native.vadProcess(this._vad, samples);
  }

  /**
   * Creates a context for reading the prediction and controlling VAD state.
   *
   * @returns {VadContext} A new context for this VAD.
   */
  getContext() {
    return new VadContext(native.vadGetContext(this._vad));
  }

  /**
   * Terminates this VAD's telemetry session before the VAD is destroyed.
   *
   * After this call, the VAD can no longer process audio. This operation may block and
   * should not be called from an audio thread.
   *
   * @throws {Error} If session termination cannot be requested.
   */
  terminateSession() {
    native.vadTerminateSession(this._vad);
  }
}

/**
 * Returns the version of the ai-coustics core SDK library used by this package.
 *
 * Note: This is not necessarily the same as this package's version.
 *
 * @returns {string} The library version as a string.
 *
 * @example
 * const version = getVersion();
 * console.log(`ai-coustics SDK version: ${version}`);
 */
function getVersion() {
  return native.getVersion();
}

/**
 * Returns the model version number compatible with this SDK build.
 *
 * @returns {number} The compatible model version number.
 */
function getCompatibleModelVersion() {
  return native.getCompatibleModelVersion();
}

module.exports = {
  Model,
  OtelConfig,
  Processor,
  ProcessorContext,
  Vad,
  VadContext,
  Collector,
  Analyzer,
  FileAnalyzer,
  analyzerPair,
  ProcessorParameter,
  VadParameter,
  getVersion,
  getCompatibleModelVersion,
};
