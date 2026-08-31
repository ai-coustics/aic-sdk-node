// Voice activity detection on the main thread.
//
// The VAD runs a dedicated VAD model and is driven independently of any processor.
// `process` reads the block and leaves it untouched; predictions are read from the context.

const { Model, Vad, VadParameter, getVersion } = require('..')

const MODEL_ID = 'vad-2.1-xxs-16khz'
const MODEL_DIR = './models'

async function main() {
  const licenseKey = process.env.AIC_SDK_LICENSE
  if (!licenseKey) {
    console.error('Error: AIC_SDK_LICENSE environment variable not set')
    console.error('Get your license key from https://developers.ai-coustics.com')
    process.exit(1)
  }

  console.log('SDK version:', getVersion())

  // A dedicated VAD model. Enhancement models are rejected.
  const modelPath = await Model.download(MODEL_ID, MODEL_DIR)
  const model = Model.fromFile(modelPath)
  console.log('Model id:', model.getId())

  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)
  console.log(`Audio format: ${blockSize} samples @ ${sampleRate} Hz`)

  const vad = new Vad(model, licenseKey)
  vad.initialize(sampleRate, blockSize)

  const context = vad.getContext()

  // How readily speech is detected, and how the decision is stabilized either side of a
  // transition. All three can be changed while audio is being processed.
  context.setParameter(VadParameter.Sensitivity, 0.8)
  context.setParameter(VadParameter.MinimumSpeechDuration, 0.1)
  context.setParameter(VadParameter.SpeechHoldDuration, 0.2)

  // The hold and minimum durations are rounded to the model's window length, so reads can
  // differ from writes.
  console.log('Sensitivity:', context.getParameter(VadParameter.Sensitivity))
  console.log('Minimum speech duration:', context.getParameter(VadParameter.MinimumSpeechDuration), 's')
  console.log('Speech hold duration:', context.getParameter(VadParameter.SpeechHoldDuration), 's')

  // The decision lags its input by this many samples. It is not applied to the audio, so
  // use it to line speech decisions up with the audio timeline.
  console.log('Prediction delay:', context.getPredictionDelay(), 'samples')

  // Silence, so nothing should be reported. Feed real speech to see this flip.
  const audio = new Float32Array(blockSize)
  for (let block = 0; block < 10; block += 1) {
    // Reads the block without modifying it, so the same buffer can go on to a processor.
    vad.process(audio)
  }

  console.log('\nSpeech detected:', context.isSpeechDetected())
  // The model's raw output, before speech-hold and thresholding.
  console.log('Raw probability:', context.getRawVadProbability().toFixed(4))

  // Clear internal state, including the published prediction, on a discontinuity or seek.
  context.reset()

  vad.terminateSession()
  console.log('\nVAD example completed successfully')
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
