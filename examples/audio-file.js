// WAV reading and writing for file-processing.js.
//
// Nothing here is SDK-specific; it is kept in its own file so the example stays about the
// SDK. `wavefile` is a devDependency of this repo; install it alongside the SDK to run
// that example:
//
//   npm install wavefile

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

  // Normalizes 16-bit PCM, 24-bit, float and the rest to the float samples the SDK wants.
  wav.toBitDepth('32f')

  // `getSamples` is declared as returning Float64Array whatever container it is handed, so
  // the Float32Array it actually produces has to be restated for the type checker.
  const samples = /** @type {Float32Array[] | Float32Array} */ (
    /** @type {unknown} */ (wav.getSamples(false, Float32Array))
  )

  // `fmt` is declared as a bare object.
  const { sampleRate } = /** @type {{ sampleRate: number }} */ (wav.fmt)

  return {
    // De-interleaved multichannel arrives as an array of channels, but mono arrives as one
    // flat array, so it is wrapped to give callers a single shape to handle.
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

  // `fromScratch` wants an array of channels for multichannel but a flat array for mono,
  // the mirror image of what `readWav` normalizes away.
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
