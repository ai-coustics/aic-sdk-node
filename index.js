// Platform-specific binary loader
let native;
try {
  // Try to load platform-specific binary from optional dependencies
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
      // Fall back to local binary
      native = require("./index.node");
    }
  } else {
    // Fall back to local binary
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
 * Model types available in the SDK
 */
const ModelType = {
  QuailL48: "QuailL48",
  QuailL16: "QuailL16",
  QuailL8: "QuailL8",
  QuailS48: "QuailS48",
  QuailS16: "QuailS16",
  QuailS8: "QuailS8",
  QuailXS: "QuailXS",
  QuailXXS: "QuailXXS",
  QuailSTT: "QuailSTT",
};

/**
 * Enhancement parameters
 */
const EnhancementParameter = {
  Bypass: "Bypass",
  EnhancementLevel: "EnhancementLevel",
  VoiceGain: "VoiceGain",
};

/**
 * VAD (Voice Activity Detection) parameters
 */
const VadParameter = {
  LookbackBufferSize: "LookbackBufferSize",
  Sensitivity: "Sensitivity",
};

/**
 * Voice Activity Detector
 */
class Vad {
  constructor(nativeVad) {
    this._vad = nativeVad;
  }

  /**
   * Check if speech is detected
   * @returns {boolean}
   */
  isSpeechDetected() {
    return native.vadIsSpeechDetected(this._vad);
  }

  /**
   * Set a VAD parameter
   * @param {string} parameter - Parameter name from VadParameter
   * @param {number} value - Parameter value
   */
  setParameter(parameter, value) {
    native.vadSetParameter(this._vad, parameter, value);
  }

  /**
   * Get a VAD parameter value
   * @param {string} parameter - Parameter name from VadParameter
   * @returns {number}
   */
  getParameter(parameter) {
    return native.vadGetParameter(this._vad, parameter);
  }
}

/**
 * AI-Coustics audio enhancement model
 */
class Model {
  /**
   * Create a new model instance
   * @param {string} modelType - Model type from ModelType enum
   * @param {string} licenseKey - SDK license key
   */
  constructor(modelType, licenseKey) {
    this._model = native.modelNew(modelType, licenseKey);
  }

  /**
   * Get the optimal sample rate for this model
   * @returns {number} Sample rate in Hz
   */
  optimalSampleRate() {
    return native.modelOptimalSampleRate(this._model);
  }

  /**
   * Get the optimal number of frames for a given sample rate
   * @param {number} sampleRate - Sample rate in Hz
   * @returns {number} Number of frames
   */
  optimalNumFrames(sampleRate) {
    return native.modelOptimalNumFrames(this._model, sampleRate);
  }

  /**
   * Initialize the model with audio configuration
   * @param {number} sampleRate - Sample rate in Hz
   * @param {number} numChannels - Number of audio channels
   * @param {number} numFrames - Number of frames per process call
   * @param {boolean} allowVariableFrames - Allow variable frame counts
   */
  initialize(sampleRate, numChannels, numFrames, allowVariableFrames = false) {
    native.modelInitialize(
      this._model,
      sampleRate,
      numChannels,
      numFrames,
      allowVariableFrames,
    );
  }

  /**
   * Get the output delay in samples
   * @returns {number} Delay in samples
   */
  outputDelay() {
    return native.modelOutputDelay(this._model);
  }

  /**
   * Reset the model's internal state
   */
  reset() {
    native.modelReset(this._model);
  }

  /**
   * Set an enhancement parameter
   * @param {string} parameter - Parameter name from EnhancementParameter
   * @param {number} value - Parameter value
   */
  setParameter(parameter, value) {
    native.modelSetParameter(this._model, parameter, value);
  }

  /**
   * Get an enhancement parameter value
   * @param {string} parameter - Parameter name from EnhancementParameter
   * @returns {number}
   */
  getParameter(parameter) {
    return native.modelGetParameter(this._model, parameter);
  }

  /**
   * Process interleaved audio (all channels mixed in one buffer)
   * @param {Float32Array} buffer - Interleaved audio buffer
   * @param {number} numChannels - Number of channels
   * @param {number} numFrames - Number of frames
   */
  processInterleaved(buffer, numChannels, numFrames) {
    native.modelProcessInterleaved(this._model, buffer, numChannels, numFrames);
  }

  /**
   * Process planar audio (separate buffer for each channel)
   * @param {Float32Array[]} buffers - Array of audio buffers, one per channel
   */
  processPlanar(buffers) {
    native.modelProcessPlanar(this._model, buffers);
  }

  /**
   * Create a Voice Activity Detector for this model
   * @returns {Vad}
   */
  createVad() {
    const nativeVad = native.modelCreateVad(this._model);
    return new Vad(nativeVad);
  }
}

/**
 * Get the SDK version
 * @returns {string}
 */
function getVersion() {
  return native.getVersion();
}

module.exports = {
  Model,
  Vad,
  ModelType,
  EnhancementParameter,
  VadParameter,
  getVersion,
};
