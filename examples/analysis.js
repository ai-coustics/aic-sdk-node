// Audio quality analysis on the calling thread and on a libuv worker.
//
// `buffer` collects audio synchronously and can continue during `analyzeAsync`.
// Analysis is computationally expensive; avoid running `analyze` in audio callbacks.

const { Analyzer, Model, getVersion } = require('..')

const MODEL_ID = 'tyto-1.1-l-16khz'
const MODEL_DIR = './models'

async function main() {
  const licenseKey = process.env.AIC_SDK_LICENSE
  if (!licenseKey) {
    console.error('Error: AIC_SDK_LICENSE environment variable not set')
    console.error('Get your license key from https://developers.ai-coustics.com')
    process.exit(1)
  }

  console.log('SDK version:', getVersion())

  // An analysis model. Enhancement and VAD models are rejected.
  const modelPath = await Model.download(MODEL_ID, MODEL_DIR)
  const model = Model.fromFile(modelPath)
  console.log('Model id:', model.getId())

  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)
  console.log(`Audio format: ${blockSize} samples @ ${sampleRate} Hz`)

  const analyzer = new Analyzer(model, licenseKey)
  analyzer.initialize(sampleRate, blockSize)

  // Only a fixed span of audio is retained, set by the model; older audio is discarded as
  // more is buffered. Analyzing before that much has arrived pads with silence.
  //
  // Analysis is mono. Mix multichannel audio down, or use one analyzer per channel.
  const audio = Float32Array.from({ length: blockSize }, () => (Math.random() - 0.5) * 0.2)
  for (let block = 0; block < 100; block += 1) {
    analyzer.buffer(audio)
  }
  console.log('Buffered 100 blocks')

  // Run analysis on a worker and count event-loop timer callbacks while it runs.
  let ticks = 0
  const ticker = setInterval(() => {
    ticks += 1
  }, 1)

  const asyncStart = performance.now()
  const result = await analyzer.analyzeAsync()
  const asyncElapsed = performance.now() - asyncStart

  clearInterval(ticker)

  // Scores range from 0.0 to 1.0. Lower values indicate fewer problems, except for
  // speakerLoudness. riskScore predicts failure in downstream speech models.
  console.log('\nAnalysis:')
  for (const [name, score] of Object.entries(result)) {
    console.log(`  ${name.padEnd(20)} ${score.toFixed(4)}`)
  }

  // The blocking form, for a CLI or a worker thread where nothing is waiting on the loop.
  const syncStart = performance.now()
  analyzer.analyze()
  const syncElapsed = performance.now() - syncStart

  console.log(`\nanalyzeAsync: ${asyncElapsed.toFixed(1)} ms, analyze: ${syncElapsed.toFixed(1)} ms`)
  // Report how many timer callbacks ran during async analysis.
  console.log(`Timer fired ${ticks} times during analyzeAsync`)

  // `buffer` drives the collector, not the analyzer, so audio can keep arriving while an
  // analysis is still running.
  const pending = analyzer.analyzeAsync()
  analyzer.buffer(audio)
  await pending
  console.log('Buffered audio while an analysis was in flight')

  // Clears buffered audio and internal state, keeping the audio settings.
  analyzer.reset()

  analyzer.terminateSession()
  console.log('\nAnalysis example completed successfully')
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
