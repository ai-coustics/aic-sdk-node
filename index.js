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
   * of the frames processed in the last `speech_hold_duration * 2` seconds.
   *
   * For example, if `speech_hold_duration` is set to 0.5 seconds and the VAD stops detecting speech
   * in the audio signal, the VAD will continue to report speech for 0.5 seconds assuming the
   * VAD does not detect speech again during that period. If a few frames of speech are detected
   * during that period, those frames will be included in the 50% calculation, which will extend
   * the speech detection period until the 50% threshold is no longer met.
   *
   * NOTE: The VAD returns a value per processed buffer, so this duration is rounded
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
   * The interpretation depends on the model:
   *   - Energy-based VADs: threshold a speech signal's energy must exceed to be
   *     considered speech. Range 1.0 to 15.0, formula: energy threshold = 10 ^ (-sensitivity).
   *   - Dedicated VAD models (e.g. Quail VAD): the speech probability threshold,
   *     in the range 0.0 to 1.0.
   *
   * Default: model-specific.
   */
  Sensitivity: native.VAD_PARAM_SENSITIVITY,

  /**
   * Controls for how long speech needs to be present in the audio signal before
   * the VAD considers it speech.
   *
   * This affects the stability of speech not detected -> detected transitions.
   *
   * Note: The VAD returns a value per processed buffer, so this duration is rounded
   * to the closest model window length.
   *
   * Range: 0.0 to 1.0 (value in seconds)
   * Default: 0.0
   */
  MinimumSpeechDuration: native.VAD_PARAM_MINIMUM_SPEECH_DURATION,
};

/**
 * Context for managing processor state and parameters.
 * Created via Processor.getProcessorContext().
 */
class ProcessorContext {
  constructor(nativeContext) {
    this._context = nativeContext;
  }

  /**
   * Clears all internal state and buffers.
   *
   * Call this when the audio stream is interrupted or when seeking
   * to prevent artifacts from previous audio content.
   *
   * The processor stays initialized to the configured settings.
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
   * which includes both algorithmic processing delay and any buffering overhead.
   * Use this value to synchronize enhanced audio with other streams or to implement
   * delay compensation in your application.
   *
   * Delay behavior:
   *   - Before initialization: Returns the base processing delay using the model's
   *     optimal frame size at its native sample rate
   *   - After initialization: Returns the actual delay for your specific configuration,
   *     including any additional buffering introduced by non-optimal frame sizes
   *
   * Important: The delay value is always expressed in samples at the sample rate
   * you configured during initialize(). To convert to time units:
   * delay_ms = (delay_samples * 1000) / sample_rate
   *
   * Note: Using frame sizes different from the optimal value returned by
   * Model.getOptimalNumFrames() will increase the delay beyond the model's base latency.
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
 * Voice Activity Detector backed by an ai-coustics speech enhancement model.
 *
 * The VAD works automatically using the enhanced audio output of the model
 * that created the VAD.
 *
 * Important:
 *   - The latency of the VAD prediction is equal to the backing model's processing latency.
 *   - If the backing model stops being processed, the VAD will not update its speech detection prediction.
 *
 * Created via Processor.getVadContext().
 *
 * @example
 * const vad = processor.getVadContext();
 * vad.setParameter(VadParameter.Sensitivity, 5.0);
 * if (vad.isSpeechDetected()) {
 *   console.log("Speech detected!");
 * }
 */
class VadContext {
  constructor(nativeContext) {
    this._context = nativeContext;
  }

  /**
   * Returns the VAD's prediction.
   *
   * Important:
   *   - The latency of the VAD prediction is equal to the backing model's processing latency.
   *   - If the backing model stops being processed, the VAD will not update its speech detection prediction.
   *
   * @returns {boolean} True if speech is detected, False otherwise.
   */
  isSpeechDetected() {
    return native.vadContextIsSpeechDetected(this._context);
  }

  /**
   * Modifies a VAD parameter.
   *
   * @param {VadParameter} parameter - Parameter to modify
   * @param {number} value - New parameter value. See parameter documentation for ranges
   * @throws {Error} If the parameter value is out of range.
   *
   * @example
   * vad.setParameter(VadParameter.SpeechHoldDuration, 0.08);
   * vad.setParameter(VadParameter.Sensitivity, 5.0);
   */
  setParameter(parameter, value) {
    native.vadContextSetParameter(this._context, parameter, value);
  }

  /**
   * Retrieves the current value of a VAD parameter.
   *
   * @param {VadParameter} parameter - Parameter to query
   * @returns {number} The current parameter value.
   *
   * @example
   * const sensitivity = vad.getParameter(VadParameter.Sensitivity);
   * console.log(`Current sensitivity: ${sensitivity}`);
   */
  getParameter(parameter) {
    return native.vadContextGetParameter(this._context, parameter);
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
 * Buffers audio for later analysis by an {@link Analyzer}.
 *
 * The collector is designed to be fed audio chunks (for example on an audio thread) that the
 * Analyzer analyzes later. All channels are mixed to mono for buffering. To buffer channels
 * independently, create separate analyzer pairs.
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
   * This must be called before buffering any audio. For the lowest delay use the sample rate
   * and frame size returned by Model.getOptimalSampleRate() and Model.getOptimalNumFrames().
   *
   * Warning: Do not call from audio processing threads as this allocates memory.
   *
   * @param {number} sampleRate - Sample rate in Hz
   * @param {number} numChannels - Number of audio channels
   * @param {number} numFrames - Samples per channel provided to each buffering call
   * @param {boolean} [allowVariableFrames=false] - Allow variable frame sizes (adds latency)
   * @throws {Error} If the audio configuration is unsupported.
   */
  initialize(sampleRate, numChannels, numFrames, allowVariableFrames = false) {
    native.collectorInitialize(
      this._collector,
      sampleRate,
      numChannels,
      numFrames,
      allowVariableFrames,
    );
  }

  /**
   * Buffers interleaved audio (channel samples alternating in one buffer).
   *
   * @param {Float32Array} buffer - Interleaved audio buffer of size numChannels * numFrames
   * @throws {Error} If buffering fails (collector not initialized, invalid buffer size, etc.)
   */
  bufferInterleaved(buffer) {
    native.collectorBufferInterleaved(this._collector, buffer);
  }

  /**
   * Buffers sequential/channel-contiguous audio (all channel 0 samples, then channel 1, etc.).
   *
   * @param {Float32Array} buffer - Sequential audio buffer of size numChannels * numFrames
   * @throws {Error} If buffering fails (collector not initialized, invalid buffer size, etc.)
   */
  bufferSequential(buffer) {
    native.collectorBufferSequential(this._collector, buffer);
  }

  /**
   * Buffers planar audio (separate buffer for each channel).
   *
   * @param {Float32Array[]} buffers - Array of audio buffers, one per channel (max 16 channels)
   * @throws {Error} If buffering fails (collector not initialized, too many channels, etc.)
   */
  bufferPlanar(buffers) {
    native.collectorBufferPlanar(this._collector, buffers);
  }
}

/**
 * Runs an analysis model over the audio buffered by a {@link Collector}.
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
   * Clears all internal state and buffers of both the analyzer and its collector.
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
   * Analyzes the buffered signal.
   *
   * Runs a forward pass of the analysis model over a fixed length of audio, determined by the
   * model. If called before the collector has buffered that length of audio, the tail of the
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
 * The {@link Collector} buffers audio chunks (for example on an audio thread) and the
 * {@link Analyzer} analyzes the buffered audio later, off the audio thread. The collector
 * retains a span of audio determined by the analysis model; as more samples are collected,
 * old audio is discarded.
 *
 * For analyzing complete mono buffers already in memory, prefer {@link FileAnalyzer}.
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
 * const numFrames = model.getOptimalNumFrames(sampleRate);
 * collector.initialize(sampleRate, 1, numFrames, false);
 */
function analyzerPair(model, licenseKey) {
  const pair = native.analyzerPair(model._model, licenseKey);
  return {
    collector: new Collector(pair.collector),
    analyzer: new Analyzer(pair.analyzer),
  };
}

/**
 * Number of seconds of audio the analysis model consumes per analysis window.
 * @private
 */
const ANALYSIS_WINDOW_SECONDS = 5;

/**
 * Computes the start sample of every analysis window on the step grid.
 * @private
 */
function analysisWindowStarts(audioLen, windowSamples, stepSamples) {
  if (audioLen <= windowSamples) {
    return [0];
  }
  const numFollowupWindows = Math.floor((audioLen - windowSamples) / stepSamples);
  const starts = [];
  for (let step = 0; step <= numFollowupWindows; step++) {
    starts.push(step * stepSamples);
  }
  return starts;
}

/**
 * Buffers exactly one analysis window into the collector using fixed-size model-hop frames.
 * Missing samples are zero-padded so short windows still reach the model's full context.
 * @private
 */
function bufferAnalysisWindow(collector, audio, start, windowSamples, frameSamples) {
  let bufferedSamples = 0;
  while (bufferedSamples < windowSamples) {
    const frameStart = start + bufferedSamples;
    const availableSamples = Math.min(
      Math.max(audio.length - frameStart, 0),
      frameSamples,
    );

    if (availableSamples === frameSamples) {
      // Fast path: the next fixed-size frame is fully available from the source audio.
      collector.bufferInterleaved(
        audio.subarray(frameStart, frameStart + frameSamples),
      );
    } else {
      // Pad short windows or non-aligned tails with silence while still feeding the
      // collector exactly one fixed-size frame.
      const frame = new Float32Array(frameSamples);
      if (availableSamples > 0) {
        frame.set(audio.subarray(frameStart, frameStart + availableSamples));
      }
      collector.bufferInterleaved(frame);
    }

    bufferedSamples += frameSamples;
  }
}

/**
 * Analyzes complete mono audio buffers.
 *
 * FileAnalyzer is a convenience wrapper around a {@link Collector} and {@link Analyzer} pair
 * for non-real-time analysis of audio that is already loaded in memory.
 *
 * Each call to analyze() configures the collector for mono input with the model's optimal frame
 * size. It analyzes independent five-second windows, advancing the start of each window by
 * stepSamples.
 *
 * For streaming or multi-channel analysis, use {@link analyzerPair} directly.
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
   * The collector is not initialized until analyze() is called. This lets the same FileAnalyzer
   * instance analyze mono buffers with different sample rates or step sizes.
   *
   * @param {Model} model - The loaded model instance
   * @param {string} licenseKey - License key for the ai-coustics SDK
   *   (generate your key at https://developers.ai-coustics.com/)
   * @throws {Error} If the analyzer pair cannot be created.
   */
  constructor(model, licenseKey) {
    // Keep a reference to the model so it stays alive for the analyzer's lifetime and so
    // analyze() can query the optimal frame size.
    this._model = model;
    const { collector, analyzer } = analyzerPair(model, licenseKey);
    this._collector = collector;
    this._analyzer = analyzer;
  }

  /**
   * Analyzes a complete mono audio buffer.
   *
   * The input must contain mono f32 samples at sampleRate. No channel mixing or resampling is
   * performed.
   *
   * The analyzer evaluates five-second windows. FileAnalyzer buffers a window starting at sample
   * 0, runs the analyzer once, resets the analyzer and collector, then repeats with a window
   * starting stepSamples later.
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
   * @throws {Error} If initialization, buffering or analysis fails.
   */
  analyze(audio, sampleRate, stepSamples = null) {
    if (!(audio instanceof Float32Array)) {
      audio = Float32Array.from(audio);
    }

    if (!(sampleRate > 0)) {
      throw new Error("sampleRate must be greater than 0");
    }

    // The analysis model consumes a fixed five-second context. Convert that duration to the
    // caller's sample rate and use it as the size of every analysis window.
    const analysisWindowSamples = sampleRate * ANALYSIS_WINDOW_SECONDS;

    const step = stepSamples == null ? analysisWindowSamples : stepSamples;
    if (!(step > 0)) {
      throw new Error("stepSamples must be greater than 0");
    }

    // The collector only emits fresh spectrogram frames at the model's hop size. Feeding any
    // other frame size would add buffering inside the collector and shift the analysis timing.
    const optimalNumFrames = this._model.getOptimalNumFrames(sampleRate);
    if (!(optimalNumFrames > 0)) {
      throw new Error("Model returned an unsupported optimal frame size");
    }

    this._collector.initialize(sampleRate, 1, optimalNumFrames, false);

    const windowStarts = analysisWindowStarts(
      audio.length,
      analysisWindowSamples,
      step,
    );

    const results = [];
    for (const windowStart of windowStarts) {
      // Each result must be computed from an independent five-second span. Reset clears both
      // the analyzer and collector before buffering the next window from scratch.
      this._analyzer.reset();
      bufferAnalysisWindow(
        this._collector,
        audio,
        windowStart,
        analysisWindowSamples,
        optimalNumFrames,
      );
      results.push(this._analyzer.analyzeBuffered());
    }

    return results;
  }
}

/**
 * OpenTelemetry configuration for a processor.
 *
 * Pass an instance as the third argument to Processor to override
 * AIC_SDK_OTEL_ENABLE for that processor only.
 */
class OtelConfig {
  /**
   * Creates an OpenTelemetry configuration for a processor.
   *
   * Pass an instance as the third argument to Processor to override
   * AIC_SDK_OTEL_ENABLE for that processor only.
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
 * High-level wrapper for the ai-coustics audio enhancement model.
 *
 * This class provides a safe, JavaScript-friendly interface to the underlying native library.
 * It handles memory management automatically.
 *
 * @example
 * const model = Model.fromFile("/path/to/model.aicmodel");
 * const processor = new Processor(model, licenseKey);
 * processor.initialize(model.getOptimalSampleRate(), 2, model.getOptimalNumFrames(sampleRate), false);
 */
class Model {
  constructor(nativeModel) {
    this._model = nativeModel;
  }

  /**
   * Creates a new audio enhancement model instance from a file.
   *
   * Multiple models can be created to process different audio streams simultaneously
   * or to switch between different enhancement algorithms during runtime.
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
   * Each model is optimized for a specific sample rate, which determines the frequency
   * range of the enhanced audio output. While you can process audio at any sample rate,
   * understanding the model's native rate helps predict the enhancement quality.
   *
   * How sample rate affects enhancement:
   *   - Models trained at lower sample rates (e.g., 8 kHz) can only enhance frequencies
   *     up to their Nyquist limit (4 kHz for 8 kHz models)
   *   - When processing higher sample rate input (e.g., 48 kHz) with a lower-rate model,
   *     only the lower frequency components will be enhanced
   *
   * Recommendation: For maximum enhancement quality across the full frequency spectrum,
   * match your input sample rate to the model's native rate when possible.
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
   * Retrieves the optimal number of frames for the model at a given sample rate.
   *
   * Using the optimal number of frames minimizes latency by avoiding internal buffering.
   *
   * When you use a different frame count than the optimal value, the model will
   * introduce additional buffering latency on top of its base processing delay.
   *
   * The optimal frame count varies based on the sample rate. Each model operates on a
   * fixed time window duration, so the required number of frames changes with sample rate.
   * For example, a model designed for 10 ms processing windows requires 480 frames at
   * 48 kHz, but only 160 frames at 16 kHz to capture the same duration of audio.
   *
   * Call this function with your intended sample rate before calling
   * Processor.initialize() to determine the best frame count for minimal latency.
   *
   * @param {number} sampleRate - The sample rate in Hz for which to calculate the optimal frame count
   * @returns {number} The optimal frame count for the given sample rate.
   *
   * @example
   * const sampleRate = model.getOptimalSampleRate();
   * const optimalFrames = model.getOptimalNumFrames(sampleRate);
   * console.log(`Optimal frame count: ${optimalFrames}`);
   */
  getOptimalNumFrames(sampleRate) {
    return native.modelGetOptimalNumFrames(this._model, sampleRate);
  }
}

/**
 * High-level wrapper for the ai-coustics audio enhancement processor.
 *
 * This class provides a safe, JavaScript-friendly interface to the underlying native library.
 * It handles memory management automatically.
 *
 * @example
 * const model = Model.fromFile("/path/to/model.aicmodel");
 * const processor = new Processor(model, licenseKey);
 * const sampleRate = model.getOptimalSampleRate();
 * const numFrames = model.getOptimalNumFrames(sampleRate);
 * processor.initialize(sampleRate, 2, numFrames, false);
 * const audio = new Float32Array(2 * numFrames);
 * processor.processInterleaved(audio);
 */
class Processor {
  /**
   * Creates a new audio enhancement processor instance.
   *
   * Multiple processors can be created to process different audio streams simultaneously
   * or to switch between different enhancement algorithms during runtime.
   *
   * @param {Model} model - The loaded model instance
   * @param {string} licenseKey - License key for the ai-coustics SDK
   *   (generate your key at https://developers.ai-coustics.com/)
   * @param {OtelConfig|null} [otelConfig=null] - Optional per-processor OpenTelemetry config.
   *   When omitted, telemetry follows the SDK environment configuration.
   * @throws {Error} If processor creation fails.
   *
   * @example
   * const model = Model.fromFile("/path/to/model.aicmodel");
   * const processor = new Processor(model, licenseKey, OtelConfig.withSessionId("session-1"));
   * processor.initialize(sampleRate, numChannels, numFrames, false);
   */
  constructor(model, licenseKey, otelConfig = null) {
    this._processor = native.processorNew(model._model, licenseKey, otelConfig);
  }

  /**
   * Configures the processor for specific audio settings.
   *
   * This function must be called before processing any audio.
   * For the lowest delay use the sample rate and frame size returned by
   * Model.getOptimalSampleRate() and Model.getOptimalNumFrames().
   *
   * Warning: Do not call from audio processing threads as this allocates memory.
   *
   * Note: All channels are mixed to mono for processing. To process channels
   * independently, create separate Processor instances.
   *
   * @param {number} sampleRate - Sample rate in Hz (8000 - 192000)
   * @param {number} numChannels - Number of audio channels
   * @param {number} numFrames - Samples per channel provided to each processing call
   * @param {boolean} [allowVariableFrames=false] - Allow variable frame sizes (adds latency)
   * @throws {Error} If the audio configuration is unsupported.
   *
   * @example
   * const sampleRate = model.getOptimalSampleRate();
   * const numFrames = model.getOptimalNumFrames(sampleRate);
   * processor.initialize(sampleRate, 2, numFrames, false);
   */
  initialize(sampleRate, numChannels, numFrames, allowVariableFrames = false) {
    native.processorInitialize(
      this._processor,
      sampleRate,
      numChannels,
      numFrames,
      allowVariableFrames,
    );
  }

  /**
   * Processes interleaved audio (all channels mixed in one buffer).
   *
   * Enhances speech in the provided audio buffer. The buffer is modified in-place.
   *
   * @param {Float32Array} buffer - Interleaved audio buffer (channel samples alternating)
   * @throws {Error} If processing fails (processor not initialized, invalid buffer size, etc.)
   *
   * @example
   * // For stereo: [L0, R0, L1, R1, L2, R2, ...]
   * const buffer = new Float32Array(numChannels * numFrames);
   * processor.processInterleaved(buffer);
   */
  processInterleaved(buffer) {
    native.processorProcessInterleaved(this._processor, buffer);
  }

  /**
   * Processes sequential/channel-contiguous audio.
   *
   * Enhances speech in the provided audio buffer. The buffer is modified in-place.
   * All samples for each channel are stored contiguously.
   *
   * @param {Float32Array} buffer - Sequential audio buffer (all channel 0 samples, then all channel 1 samples, etc.)
   * @throws {Error} If processing fails (processor not initialized, invalid buffer size, etc.)
   *
   * @example
   * // For stereo: [L0, L1, L2, ..., R0, R1, R2, ...]
   * const buffer = new Float32Array(numChannels * numFrames);
   * processor.processSequential(buffer);
   */
  processSequential(buffer) {
    native.processorProcessSequential(this._processor, buffer);
  }

  /**
   * Processes planar audio (separate buffer for each channel).
   *
   * Enhances speech in the provided audio buffers. The buffers are modified in-place.
   *
   * @param {Float32Array[]} buffers - Array of audio buffers, one per channel (max 16 channels)
   * @throws {Error} If processing fails (processor not initialized, too many channels, invalid buffer size, etc.)
   *
   * @example
   * const left = new Float32Array(numFrames);
   * const right = new Float32Array(numFrames);
   * processor.processPlanar([left, right]);
   */
  processPlanar(buffers) {
    native.processorProcessPlanar(this._processor, buffers);
  }

  /**
   * Creates a ProcessorContext instance.
   *
   * This can be used to control all parameters and other settings of the processor.
   *
   * @returns {ProcessorContext} A new ProcessorContext instance.
   *
   * @example
   * const processorContext = processor.getProcessorContext();
   * processorContext.setParameter(ProcessorParameter.EnhancementLevel, 0.8);
   */
  getProcessorContext() {
    const nativeContext = native.processorGetProcessorContext(this._processor);
    return new ProcessorContext(nativeContext);
  }

  /**
   * Creates a Voice Activity Detector Context instance.
   *
   * @returns {VadContext} A new VadContext instance.
   *
   * @example
   * const vad = processor.getVadContext();
   * if (vad.isSpeechDetected()) {
   *   console.log("Speech detected!");
   * }
   */
  getVadContext() {
    const nativeContext = native.processorGetVadContext(this._processor);
    return new VadContext(nativeContext);
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
