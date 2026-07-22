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

/**
 * Finds an existing model file in the target directory whose name starts with a prefix.
 * @param {string} targetDir - Directory to search in
 * @param {string} prefix - File name prefix to match (e.g. "quail_vf")
 * @returns {string|null} - Path to found model or null
 */
function findExistingModel(targetDir, prefix) {
  if (!fs.existsSync(targetDir)) {
    return null;
  }
  const entries = fs.readdirSync(targetDir);
  for (const entry of entries) {
    if (entry.endsWith(".aicmodel") && entry.startsWith(prefix)) {
      return path.join(targetDir, entry);
    }
  }
  return null;
}

/**
 * Gets the path to the test model, downloading if necessary.
 * @returns {string} - Path to the model file
 */
function getTestModelPath() {
  const targetDir = path.join(__dirname, "..", "target");

  const existing = findExistingModel(targetDir, "quail_vf");
  if (existing) {
    return existing;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return Model.download("quail-vf-2.1-s-16khz", targetDir);
}

/**
 * Gets the path to the analysis test model, downloading if necessary.
 * @returns {string} - Path to the analysis model file
 */
function getAnalysisModelPath() {
  const targetDir = path.join(__dirname, "..", "target");

  const existing = findExistingModel(targetDir, "tyto");
  if (existing) {
    return existing;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return Model.download("tyto-l-16khz", targetDir);
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
 * @property {number} numFrames - Number of samples
 * @property {Float32Array} samples - Mono audio samples
 */

/**
 * Loads a mono WAV file and returns audio data.
 * Uses manual normalization to match Rust's hound library exactly (no dithering).
 * @param {string} filePath - Path to the WAV file
 * @returns {TestAudio} - Audio data structure
 */
function loadWavAudio(filePath) {
  const buffer = fs.readFileSync(filePath);
  const wav = new WaveFile(buffer);

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
    // Read raw buffer directly as Float32Array (wavefile misinterprets float samples)
    const dataBuffer = wav.data.samples;
    samples = new Float32Array(
      dataBuffer.buffer,
      dataBuffer.byteOffset,
      dataBuffer.length / 4,
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
    numFrames: samples.length,
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
  getAnalysisModelPath,
  licenseKey,
  loadWavAudio,
  approxEqual,
};
