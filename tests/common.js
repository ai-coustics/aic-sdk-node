const fs = require("fs");
const path = require("path");
const WaveFile = require("wavefile").WaveFile;

const { Model } = require("..");

const TEST_AUDIO_PATH = path.join(__dirname, "data", "test_signal.wav");
const TEST_AUDIO_ENHANCED_PATH = path.join(
  __dirname,
  "data",
  "test_signal_enhanced.wav",
);
const VAD_RESULTS_PATH = path.join(__dirname, "data", "vad_results.json");

/** Enhancement model used for the audio enhancement tests. */
const ENHANCEMENT_MODEL_ID = "quail-vf-2.2-s-16khz";
/**
 * Dedicated VAD model used for the voice activity detection tests. Enhancement models cannot
 * be used for voice activity detection.
 */
const VAD_MODEL_ID = "vad-2.1-xxs-16khz";
/** Analysis model used for the analyzer tests. */
const ANALYSIS_MODEL_ID = "tyto-1.1-l-16khz";

/**
 * Finds an existing model file in the target directory that belongs to a model ID.
 * @param {string} targetDir - Directory to search in
 * @param {string} modelId - Model ID whose file name prefix to match
 * @returns {string|null} - Path to found model or null
 */
function findExistingModel(targetDir, modelId) {
  if (!fs.existsSync(targetDir)) {
    return null;
  }
  const prefix = modelId.replace(/[-.]/g, "_");
  const entries = fs.readdirSync(targetDir);
  for (const entry of entries) {
    if (entry.endsWith(".aicmodel") && entry.startsWith(prefix)) {
      return path.join(targetDir, entry);
    }
  }
  return null;
}

/**
 * Downloads a model into the package's target directory, reusing an already downloaded file.
 * @param {string} modelId - Model ID to resolve
 * @returns {string} - Path to the model file
 */
function getModelPath(modelId) {
  const targetDir = path.join(__dirname, "..", "target");

  const existing = findExistingModel(targetDir, modelId);
  if (existing) {
    return existing;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return Model.download(modelId, targetDir);
}

/**
 * Gets the path to the enhancement test model, downloading if necessary.
 * @returns {string} - Path to the model file
 */
function getTestModelPath() {
  return getModelPath(ENHANCEMENT_MODEL_ID);
}

/**
 * Gets the path to the dedicated VAD test model, downloading if necessary.
 * @returns {string} - Path to the VAD model file
 */
function getVadModelPath() {
  return getModelPath(VAD_MODEL_ID);
}

/**
 * Gets the path to the analysis test model, downloading if necessary.
 * @returns {string} - Path to the analysis model file
 */
function getAnalysisModelPath() {
  return getModelPath(ANALYSIS_MODEL_ID);
}

/**
 * Gets the license key from environment variable.
 * @returns {string} - The license key
 * @throws {Error} If AIC_SDK_LICENSE is not set
 */
function licenseKey() {
  const key = process.env.AIC_SDK_LICENSE;
  if (!key) {
    throw new Error("AIC_SDK_LICENSE environment variable not set");
  }
  return key;
}

/**
 * Audio data structure returned by loadWavAudio.
 * @typedef {Object} TestAudio
 * @property {number} sampleRate - Sample rate in Hz
 * @property {number} sampleCount - Number of samples
 * @property {Float32Array} samples - Mono audio samples
 */

/**
 * Loads a mono WAV file and returns audio data.
 * Uses manual normalization to match Rust's hound library exactly (no dithering).
 * @param {string} filePath - Path to the WAV file
 * @returns {TestAudio} - Audio data structure
 */
function loadWavAudio(filePath) {
  const fileBytes = fs.readFileSync(filePath);
  const wav = new WaveFile(fileBytes);

  const sampleRate = wav.fmt.sampleRate;
  const audioFormat = wav.fmt.audioFormat;
  const bitsPerSample = wav.fmt.bitsPerSample;

  let samples;

  // Check if this is a 32-bit float format
  const isFloat32 =
    audioFormat === 3 ||
    (audioFormat === 65534 &&
      wav.fmt.subformat?.[0] === 3 &&
      bitsPerSample === 32);

  if (isFloat32) {
    // View the raw sample bytes directly as float32 values (wavefile misinterprets them).
    const sampleBytes = wav.data.samples;
    samples = new Float32Array(
      sampleBytes.buffer,
      sampleBytes.byteOffset,
      sampleBytes.length / 4,
    );
  } else {
    // Integer format: normalize manually (divide by 2^(bits-1), no dithering)
    const rawSamples = wav.getSamples(true);
    const maxValue = 1 << (bitsPerSample - 1);
    samples = new Float32Array(rawSamples.length);
    for (let i = 0; i < rawSamples.length; i++) {
      samples[i] = rawSamples[i] / maxValue;
    }
  }

  return {
    sampleRate,
    sampleCount: samples.length,
    samples,
  };
}

/**
 * Checks if two floating point numbers are approximately equal.
 * @param {number} a - First number
 * @param {number} b - Second number
 * @param {number} epsilon - Maximum allowed difference
 * @returns {boolean} - True if approximately equal
 */
function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon;
}

module.exports = {
  TEST_AUDIO_PATH,
  TEST_AUDIO_ENHANCED_PATH,
  VAD_RESULTS_PATH,
  getTestModelPath,
  getVadModelPath,
  getAnalysisModelPath,
  licenseKey,
  loadWavAudio,
  approxEqual,
};
