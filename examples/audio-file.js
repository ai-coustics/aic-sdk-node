// WAV reading and writing for file-processing.js.
//
// Requires `wavefile`, included in this repository's devDependencies.
// For use outside this repository: npm install wavefile

const fs = require('node:fs')

const { WaveFile } = require('wavefile')

/**
 * Reads a WAV file into one Float32Array per channel.
 *
 * @param {string} path
 * @returns {{ channels: Float32Array[], sampleRate: number }}
 */
function readWav(path) {
  const wav = new WaveFile(fs.readFileSync(path))

  // Convert PCM and floating-point WAV samples to the floating-point format used by the SDK.
  wav.toBitDepth('32f')

  // The wavefile type declaration does not reflect the requested Float32Array output.
  const samples = /** @type {Float32Array[] | Float32Array} */ (
    /** @type {unknown} */ (wav.getSamples(false, Float32Array))
  )

  // `fmt` is declared as a bare object.
  const { sampleRate } = /** @type {{ sampleRate: number }} */ (wav.fmt)

  return {
    // Return an array of channels for both mono and multichannel input.
    channels: Array.isArray(samples) ? samples : [samples],
    sampleRate,
  }
}

/**
 * Writes one Float32Array per channel to a 32-bit float WAV file.
 *
 * @param {string} path
 * @param {Float32Array[]} channels
 * @param {number} sampleRate
 */
function writeWav(path, channels, sampleRate) {
  const wav = new WaveFile()

  // `fromScratch` expects a flat array for mono and an array of channels otherwise.
  wav.fromScratch(channels.length, sampleRate, '32f', channels.length === 1 ? channels[0] : channels)

  fs.writeFileSync(path, wav.toBuffer())
}

/**
 * Appends `_enhanced` to a path, keeping the extension: `a/b.wav` -> `a/b_enhanced.wav`.
 *
 * @param {string} inputPath
 * @returns {string}
 */
function enhancedPath(inputPath) {
  return inputPath.replace(/(\.[^.\\/]+)?$/, '_enhanced$1')
}

module.exports = { enhancedPath, readWav, writeWav }
