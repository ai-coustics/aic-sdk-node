// Voice activity detection on Node's libuv thread pool.
//
// `process` returns a promise for a copy of the original samples. The final example
// passes this audio to an enhancement processor after detection.

const { Model, ProcessorAsync, VadAsync, VadParameter, getVersion } = require('..')

const VAD_MODEL_ID = 'vad-2.1-xxs-16khz'
const ENHANCEMENT_MODEL_ID = 'quail-vf-2.2-s-16khz'
const MODEL_DIR = './models'

async function main() {
  const licenseKey = process.env.AIC_SDK_LICENSE
  if (!licenseKey) {
    console.error('Error: AIC_SDK_LICENSE environment variable not set')
    console.error('Get your license key from https://developers.ai-coustics.com')
    process.exit(1)
  }

  console.log('SDK version:', getVersion())

  const model = Model.fromFile(await Model.download(VAD_MODEL_ID, MODEL_DIR))
  console.log('Model id:', model.getId())

  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)
  console.log(`Audio format: ${blockSize} samples @ ${sampleRate} Hz`)

  const vad = await new VadAsync(model, licenseKey).withConfig(sampleRate, blockSize)

  // Await context creation. Prediction and parameter methods are synchronous.
  const context = await vad.getContext()

  context.setParameter(VadParameter.Sensitivity, 0.8)
  context.setParameter(VadParameter.MinimumSpeechDuration, 0.1)
  context.setParameter(VadParameter.SpeechHoldDuration, 0.2)

  console.log('Sensitivity:', context.getParameter(VadParameter.Sensitivity))
  console.log('Prediction delay:', context.getPredictionDelay(), 'samples')

  // Process silence as sample input. Replace this with audio from your source.
  let audio = new Float32Array(blockSize)
  for (let block = 0; block < 10; block += 1) {
    // Resolves to the same samples, unmodified, so one variable carries the stream.
    audio = await vad.process(audio)
  }

  console.log('\nSpeech detected:', context.isSpeechDetected())
  console.log('Raw probability:', context.getRawVadProbability().toFixed(4))

  // Run detection before enhancement so the VAD receives the original input.
  // Enhanced audio changes the signal seen by the VAD and adds processing delay.
  console.log('\nRunning detection and enhancement on the same stream')

  const enhancementModel = Model.fromFile(await Model.download(ENHANCEMENT_MODEL_ID, MODEL_DIR))

  // Configure both instances with the same block size to share input blocks.
  // Models may have different optimal block sizes.
  const processor = await new ProcessorAsync(enhancementModel, licenseKey).withConfig(sampleRate, blockSize)
  const processorContext = await processor.getContext()

  for (let i = 0; i < 10; i += 1) {
    // Read a new input block for each iteration; do not reuse enhanced output as VAD input.
    const block = Float32Array.from({ length: blockSize }, () => (Math.random() - 0.5) * 0.2)

    // The VAD sees the input, then the processor enhances it.
    const enhanced = await processor.process(await vad.process(block))

    // Hand the enhanced audio on to playback or an encoder from here.
    console.log(`Block ${i}: speech ${context.isSpeechDetected()}, ${enhanced.length} samples out`)
  }

  // Audio delay and VAD prediction delay are independent measurements in samples.
  console.log('Audio delay:', processorContext.getAudioDelay(), 'samples')
  console.log('Prediction delay:', context.getPredictionDelay(), 'samples')

  await vad.terminateSession()
  await processor.terminateSession()
  console.log('\nAsync VAD example completed successfully')
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
