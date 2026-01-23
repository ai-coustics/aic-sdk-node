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
   * Controls the intensity of speech enhancement processing.
   *
   * Range: 0.0 to 1.0
   *   - 0.0: Bypass mode - original signal passes through unchanged
   *   - 1.0: Full enhancement - maximum noise reduction but also more audible artifacts
   *
   * Default: 1.0
   */
  EnhancementLevel: native.PROCESSOR_PARAM_ENHANCEMENT_LEVEL,

  /**
   * Compensates for perceived volume reduction after noise removal.
   *
   * Range: 0.1 to 4.0 (linear amplitude multiplier)
   *   - 0.1: Significant volume reduction (-20 dB)
   *   - 1.0: No gain change (0 dB, default)
   *   - 2.0: Double amplitude (+6 dB)
   *   - 4.0: Maximum boost (+12 dB)
   *
   * Formula: Gain (dB) = 20 × log₁₀(value)
   *
   * Default: 1.0
   */
  VoiceGain: native.PROCESSOR_PARAM_VOICE_GAIN,
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
   * The VAD reports speech detected if the audio signal contained speech in at least 50%
   * of the frames processed in the last speech_hold_duration seconds.
   *
   * This affects the stability of speech detected -> not detected transitions.
   *
   * Note: The VAD returns a value per processed buffer, so this duration is rounded
   * to the closest model window length.
   *
   * Range: 0.0 to 100x model window length (value in seconds)
   * Default: 0.05 (50 ms)
   */
  SpeechHoldDuration: native.VAD_PARAM_SPEECH_HOLD_DURATION,

  /**
   * Controls the sensitivity (energy threshold) of the VAD.
   *
   * This value is used by the VAD as the threshold a speech audio signal's energy
   * has to exceed in order to be considered speech.
   *
   * Range: 1.0 to 15.0
   * Formula: Energy threshold = 10 ^ (-sensitivity)
   * Default: 6.0
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
   * @throws {Error} If processor creation fails.
   *
   * @example
   * const model = Model.fromFile("/path/to/model.aicmodel");
   * const processor = new Processor(model, licenseKey);
   * processor.initialize(sampleRate, numChannels, numFrames, false);
   */
  constructor(model, licenseKey) {
    this._processor = native.processorNew(model._model, licenseKey);
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
  Processor,
  ProcessorContext,
  VadContext,
  ProcessorParameter,
  VadParameter,
  getVersion,
  getCompatibleModelVersion,
};
