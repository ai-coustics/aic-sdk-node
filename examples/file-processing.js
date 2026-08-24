// Enhances a WAV file end to end.
//
// Shows the two things a file tool needs beyond the basic loop: one processor per channel,
// and compensating for the processor's delay so the output lines up with the input.
//
// Usage:
//   node examples/file-processing.js --input speech.wav [--output enhanced.wav]
//                                    [--model quail-vf-2.2-s-16khz] [--enhancement 1.0]

const { Model, Processor, ProcessorParameter, getVersion } = require('..')
const { enhancedPath, readWav, writeWav } = require('./audio-file.js')

const MODEL_DIR = './models'

const USAGE = `Enhances a WAV file.

Usage: node examples/file-processing.js --input <file.wav> [options]

Options:
  -i, --input <file>         WAV file to enhance (required)
  -o, --output <file>        Where to write the result (default: <input>_enhanced.wav)
  -m, --model <id>           Model to use (default: quail-vf-2.2-s-16khz)
  -e, --enhancement <0..1>   Enhancement level (default: 1.0)
  -h, --help                 Show this message

A model only enhances up to its own Nyquist limit, so pair a 48 kHz source with a 48 kHz
model such as rook-l-48khz. Browse models at https://artifacts.ai-coustics.io`

/**
 * @typedef {object} Options
 * @property {string} [input] WAV file to enhance
 * @property {string} [output] Where to write the result
 * @property {string} model Model id
 * @property {number} enhancement Enhancement level, 0.0 - 1.0
 * @property {boolean} [help] Whether usage was requested
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Options} */
  const options = { model: 'quail-vf-2.2-s-16khz', enhancement: 1.0 }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case '-i':
      case '--input':
        options.input = argv[(i += 1)]
        break
      case '-o':
      case '--output':
        options.output = argv[(i += 1)]
        break
      case '-m':
      case '--model':
        options.model = argv[(i += 1)]
        break
      case '-e':
      case '--enhancement':
        options.enhancement = Number(argv[(i += 1)])
        break
      case '-h':
      case '--help':
        options.help = true
        break
      default:
        // A lone path with no flag is taken as the input, so the common case needs no flags.
        if (!arg.startsWith('-') && !options.input) {
          options.input = arg
        } else {
          throw new Error(`Unrecognized argument: ${arg}`)
        }
    }
  }

  // Whether an input was given is checked by the caller, which needs the narrowed value
  // anyway; this only validates what was actually passed.
  if (!options.help && (!Number.isFinite(options.enhancement) || options.enhancement < 0 || options.enhancement > 1)) {
    throw new Error('--enhancement must be a number between 0.0 and 1.0')
  }

  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return
  }

  const { input } = options
  if (!input) {
    throw new Error('An input file is required. Pass --input <file.wav>, or --help for usage.')
  }

  const licenseKey = process.env.AIC_SDK_LICENSE
  if (!licenseKey) {
    console.error('Error: AIC_SDK_LICENSE environment variable not set')
    console.error('Get your license key from https://developers.ai-coustics.com')
    process.exit(1)
  }

  console.log('SDK version:', getVersion())

  const { channels, sampleRate } = readWav(input)
  const frames = channels[0].length
  console.log(
    `Read ${input}: ${channels.length} channel(s), ${frames} frames @ ${sampleRate} Hz ` +
      `(${(frames / sampleRate).toFixed(2)} s)`,
  )

  const model = Model.fromFile(await Model.download(options.model, MODEL_DIR))
  console.log('Model id:', model.getId())

  // The file's rate drives the format, not the model's: the SDK resamples internally. The
  // block size that avoids extra buffering depends on that rate.
  const blockSize = model.getOptimalBlockSize(sampleRate)

  // Processing is mono, so each channel gets its own processor and its own internal state.
  const processors = channels.map(() => {
    const processor = new Processor(model, licenseKey)
    processor.initialize(sampleRate, blockSize)

    const context = processor.getContext()
    context.setParameter(ProcessorParameter.EnhancementLevel, options.enhancement)

    return { processor, context }
  })

  // Enhanced audio comes out this many samples late. Feeding that many extra samples of
  // silence flushes the tail, and skipping that many samples of output realigns the result
  // with the input. Without this the file would be shifted and truncated.
  const delay = processors[0].context.getAudioDelay()
  console.log(`Block size: ${blockSize}, enhancement level: ${options.enhancement}, delay: ${delay} samples`)

  // Padded to a whole number of blocks so every call gets exactly `blockSize` samples.
  const paddedLength = Math.ceil((frames + delay) / blockSize) * blockSize

  const started = performance.now()
  const enhanced = channels.map((channel, index) => {
    const padded = new Float32Array(paddedLength)
    padded.set(channel)

    for (let offset = 0; offset < paddedLength; offset += blockSize) {
      // A view onto `padded`, not a copy, and `process` enhances in place, so the result
      // is written straight back into the output buffer.
      processors[index].processor.process(padded.subarray(offset, offset + blockSize))
    }

    return padded.subarray(delay, delay + frames)
  })
  const elapsed = performance.now() - started

  const output = options.output ?? enhancedPath(input)
  writeWav(output, enhanced, sampleRate)

  const audioMs = (frames / sampleRate) * 1000
  console.log(`\nProcessed in ${elapsed.toFixed(0)} ms (${(audioMs / elapsed).toFixed(1)}x real time)`)
  console.log('Wrote', output)

  for (const { processor } of processors) {
    processor.terminateSession()
  }
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
