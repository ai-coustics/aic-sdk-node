// Energy-based voice activity detection with an enhancement processor.
//
// The detector uses the processor's enhanced signal before output mixing, so it needs no
// separate VAD model. Predictions update as the processor processes audio.

const { Model, Processor, VadParameter, getVersion } = require('..')

const MODEL_ID = 'quail-vf-2.2-s-16khz'
const MODEL_DIR = './models'

async function main() {
  const licenseKey = process.env.AIC_SDK_LICENSE
  if (!licenseKey) {
    console.error('Error: AIC_SDK_LICENSE environment variable not set')
    console.error('Get your license key from https://developers.ai-coustics.com')
    process.exit(1)
  }

  console.log('SDK version:', getVersion())

  // An enhancement model. Dedicated VAD models are used with `Vad` instead.
  const modelPath = await Model.download(MODEL_ID, MODEL_DIR)
  const model = Model.fromFile(modelPath)
  console.log('Model id:', model.getId())

  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)
  console.log(`Audio format: ${blockSize} samples @ ${sampleRate} Hz`)

  const processor = new Processor(model, licenseKey)
  processor.initialize(sampleRate, blockSize)

  // Creating a context keeps inference active, even when the processor is bypassed.
  const context = processor.getEnergyVadContext()

  // Higher sensitivity detects quieter speech; the energy VAD range is 1.0 to 15.0.
  context.setParameter(VadParameter.Sensitivity, 6.0)
  context.setParameter(VadParameter.SpeechHoldDuration, 0.08)

  console.log('Sensitivity:', context.getParameter(VadParameter.Sensitivity))
  console.log('Speech hold duration:', context.getParameter(VadParameter.SpeechHoldDuration), 's')

  // The decision lags its input by this many samples. It matches the processor's audio delay.
  console.log('Prediction delay:', context.getPredictionDelay(), 'samples')
  console.log('Audio delay:', processor.getContext().getAudioDelay(), 'samples')

  // Process silence as sample input. Replace this with audio from your source.
  const audio = new Float32Array(blockSize)
  for (let block = 0; block < 10; block += 1) {
    processor.process(audio)
  }

  console.log('\nSpeech detected:', context.isSpeechDetected())

  // Clear the prediction on a discontinuity or seek. Resetting the processor through its
  // context also resets the energy VAD.
  context.reset()

  processor.terminateSession()
  console.log('\nEnergy VAD example completed successfully')
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
