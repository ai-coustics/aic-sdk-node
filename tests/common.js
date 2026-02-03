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
 * Finds an existing model file in the target directory.
 * @param {string} targetDir - Directory to search in
 * @returns {string|null} - Path to found model or null
 */
function findExistingModel(targetDir) {
  if (!fs.existsSync(targetDir)) {
    return null;
  }
  const entries = fs.readdirSync(targetDir);
  for (const entry of entries) {
    if (entry.endsWith(".aicmodel") && entry.startsWith("sparrow_xxs_48khz")) {
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

  const existing = findExistingModel(targetDir);
  if (existing) {
    return existing;
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return Model.download("sparrow-xxs-48khz", targetDir);
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
 * @property {number} numChannels - Number of audio channels
 * @property {number} numFrames - Number of frames (samples per channel)
 * @property {Float32Array} interleavedSamples - Interleaved audio samples
 */

/**
 * Loads a WAV file and returns audio data.
 * Uses manual normalization to match Rust's hound library exactly (no dithering).
 * @param {string} filePath - Path to the WAV file
 * @returns {TestAudio} - Audio data structure
 */
function loadWavAudio(filePath) {
  const buffer = fs.readFileSync(filePath);
  const wav = new WaveFile(buffer);

  const sampleRate = wav.fmt.sampleRate;
  const numChannels = wav.fmt.numChannels;
  const audioFormat = wav.fmt.audioFormat;
  const bitsPerSample = wav.fmt.bitsPerSample;

  let interleavedSamples;

  // Check if this is a 32-bit float format
  const isFloat32 =
    audioFormat === 3 ||
    (audioFormat === 65534 &&
      wav.fmt.subformat?.[0] === 3 &&
      bitsPerSample === 32);

  if (isFloat32) {
    // Read raw buffer directly as Float32Array (wavefile misinterprets float samples)
    const dataBuffer = wav.data.samples;
    interleavedSamples = new Float32Array(
      dataBuffer.buffer,
      dataBuffer.byteOffset,
      dataBuffer.length / 4,
    );
  } else {
    // Integer format: normalize manually (divide by 2^(bits-1), no dithering)
    const rawSamples = wav.getSamples(true);
    const maxValue = 1 << (bitsPerSample - 1);
    interleavedSamples = new Float32Array(rawSamples.length);
    for (let i = 0; i < rawSamples.length; i++) {
      interleavedSamples[i] = rawSamples[i] / maxValue;
    }
  }

  return {
    sampleRate,
    numChannels,
    numFrames: interleavedSamples.length / numChannels,
    interleavedSamples,
  };
}

/**
 * Converts interleaved audio to sequential format.
 * @param {Float32Array} interleaved - Interleaved samples [L0, R0, L1, R1, ...]
 * @param {number} numChannels - Number of channels
 * @returns {Float32Array} - Sequential samples [L0, L1, ..., R0, R1, ...]
 */
function interleavedToSequential(interleaved, numChannels) {
  const numFrames = interleaved.length / numChannels;
  const sequential = new Float32Array(interleaved.length);
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      sequential[ch * numFrames + frame] =
        interleaved[frame * numChannels + ch];
    }
  }
  return sequential;
}

/**
 * Converts sequential audio to interleaved format.
 * @param {Float32Array} sequential - Sequential samples [L0, L1, ..., R0, R1, ...]
 * @param {number} numChannels - Number of channels
 * @returns {Float32Array} - Interleaved samples [L0, R0, L1, R1, ...]
 */
function sequentialToInterleaved(sequential, numChannels) {
  const numFrames = sequential.length / numChannels;
  const interleaved = new Float32Array(sequential.length);
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      interleaved[frame * numChannels + ch] =
        sequential[ch * numFrames + frame];
    }
  }
  return interleaved;
}

/**
 * Converts interleaved audio to planar format.
 * @param {Float32Array} interleaved - Interleaved samples [L0, R0, L1, R1, ...]
 * @param {number} numChannels - Number of channels
 * @returns {Float32Array[]} - Array of Float32Arrays, one per channel
 */
function interleavedToPlanar(interleaved, numChannels) {
  const numFrames = interleaved.length / numChannels;
  const planar = [];
  for (let ch = 0; ch < numChannels; ch++) {
    planar.push(new Float32Array(numFrames));
  }
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      planar[ch][frame] = interleaved[frame * numChannels + ch];
    }
  }
  return planar;
}

/**
 * Converts planar audio to interleaved format.
 * @param {Float32Array[]} planar - Array of Float32Arrays, one per channel
 * @returns {Float32Array} - Interleaved samples [L0, R0, L1, R1, ...]
 */
function planarToInterleaved(planar) {
  const numChannels = planar.length;
  const numFrames = planar[0].length;
  const interleaved = new Float32Array(numChannels * numFrames);
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      interleaved[frame * numChannels + ch] = planar[ch][frame];
    }
  }
  return interleaved;
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
  licenseKey,
  loadWavAudio,
  interleavedToSequential,
  sequentialToInterleaved,
  interleavedToPlanar,
  planarToInterleaved,
  approxEqual,
};
