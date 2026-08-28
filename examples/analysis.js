// Audio quality analysis.
//
// Buffering and analysis are deliberately separate calls: `buffer` is cheap enough for the
// audio path, while running the model is not. Analysis therefore comes in two forms, both
// shown below: `analyzeAsync` on a worker thread and `analyze` on the calling thread.
//
// There is no separate `AnalyzerAsync` class, because only one call moves off-thread:
// `buffer` stays synchronous so it stays cheap, and can be called while an analysis runs.

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

  // The heavy call, on a worker thread. This is the one to reach for in a server: analysis
  // is occasional, so a promise costs nothing next to running the model, and the event loop
  // stays free for everything else.
  let ticks = 0
  const ticker = setInterval(() => {
    ticks += 1
  }, 1)

  const asyncStart = performance.now()
  const result = await analyzer.analyzeAsync()
  const asyncElapsed = performance.now() - asyncStart

  clearInterval(ticker)

  // Every score runs 0.0 - 1.0. Except `speakerLoudness`, lower means less problematic
  // audio. `riskScore` is the headline number: how likely this audio is to break downstream
  // models such as speech-to-text, VAD or turn-taking.
  console.log('\nAnalysis:')
  for (const [name, score] of Object.entries(result)) {
    console.log(`  ${name.padEnd(20)} ${score.toFixed(4)}`)
  }

  // The blocking form, for a CLI or a worker thread where nothing is waiting on the loop.
  const syncStart = performance.now()
  analyzer.analyze()
  const syncElapsed = performance.now() - syncStart

  console.log(`\nanalyzeAsync: ${asyncElapsed.toFixed(1)} ms, analyze: ${syncElapsed.toFixed(1)} ms`)
  // The blocking call would have held the event loop for its whole duration; the async one
  // does not, which is what these ticks show.
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
