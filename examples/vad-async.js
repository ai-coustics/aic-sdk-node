// Voice activity detection off the main thread.
//
// `VadAsync` mirrors `Vad` on a worker thread. `process` copies the block in and hands it
// straight back, which is what makes the combined pattern at the end of this file read
// cleanly: the same block goes to the VAD and then on to the processor.

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

  // Awaited once; every method on the handle itself is synchronous, so predictions can be
  // read from anywhere, including from inside an audio callback.
  const context = await vad.getContext()

  context.setParameter(VadParameter.Sensitivity, 0.8)
  context.setParameter(VadParameter.MinimumSpeechDuration, 0.1)
  context.setParameter(VadParameter.SpeechHoldDuration, 0.2)

  console.log('Sensitivity:', context.getParameter(VadParameter.Sensitivity))
  console.log('Prediction delay:', context.getPredictionDelay(), 'samples')

  // Silence, so nothing should be reported. Feed real speech to see this flip.
  let audio = new Float32Array(blockSize)
  for (let block = 0; block < 10; block += 1) {
    // Resolves to the same samples, unmodified, so one variable carries the stream.
    audio = await vad.process(audio)
  }

  console.log('\nSpeech detected:', context.isSpeechDetected())
  console.log('Raw probability:', context.rawVadProbability().toFixed(4))

  // Detection and enhancement together.
  //
  // The VAD must see the *original* audio, not the processor's output: enhancement is
  // designed to change the signal, so detecting on its output runs the VAD model on audio
  // it was not trained for, and stacks the processor's delay onto the prediction. Because
  // the VAD hands its block back untouched, ordering the two calls is all it takes.
  console.log('\nRunning detection and enhancement on the same stream')

  const enhancementModel = Model.fromFile(await Model.download(ENHANCEMENT_MODEL_ID, MODEL_DIR))

  // Initialized with the *VAD's* block size, not the enhancement model's own optimum, so
  // that one block can be handed to both. Two models need not agree on an optimal block
  // size, and feeding a processor a block it was not configured for is an error, so when
  // sharing a stream, pick one size and configure everything with it.
  const processor = await new ProcessorAsync(enhancementModel, licenseKey).withConfig(sampleRate, blockSize)
  const processorContext = await processor.getContext()

  let block = Float32Array.from({ length: blockSize }, () => (Math.random() - 0.5) * 0.2)
  for (let i = 0; i < 10; i += 1) {
    // The VAD sees the input, then the processor enhances it.
    const enhanced = await processor.process(await vad.process(block))

    // Hand the enhanced audio on to playback or an encoder here. The next iteration needs
    // unenhanced input again, so in a real stream `block` would come from the source.
    block = enhanced
  }

  // The two delays describe different things and are independent: one shifts the audio,
  // the other tells you how far behind the decision is.
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
