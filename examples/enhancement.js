// Speech enhancement on the main thread.
//
// The synchronous API: `process` enhances a block in place and returns nothing. Use this
// when you are already on a dedicated audio thread. For a server or batch job, see
// enhancement-async.js.

const { Model, Processor, ProcessorParameter, getCompatibleModelVersion, getVersion } = require('..')

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
  console.log('Compatible model version:', getCompatibleModelVersion())

  // Enhancement models improve speech quality. See vad.js for voice activity detection and
  // analysis.js for audio analysis; each class accepts only its own family of models.
  // Browse the catalogue at https://artifacts.ai-coustics.io
  const modelPath = await Model.download(MODEL_ID, MODEL_DIR)
  console.log('Model downloaded to:', modelPath)

  const model = Model.fromFile(modelPath)
  console.log('Model id:', model.getId())

  // The model's own settings give the lowest delay.
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)
  console.log(`Audio format: ${blockSize} samples @ ${sampleRate} Hz`)

  const processor = new Processor(model, licenseKey)
  processor.initialize(sampleRate, blockSize)

  // Parameters and state are reached through a context handle, which stays usable while
  // audio is being processed.
  const context = processor.getContext()
  console.log('Audio delay:', context.getAudioDelay(), 'samples')

  context.setParameter(ProcessorParameter.EnhancementLevel, 0.7)
  console.log('Enhancement level:', context.getParameter(ProcessorParameter.EnhancementLevel))

  // Stand-in for real audio: noise at a low level. Feed this real speech to hear anything.
  const audio = Float32Array.from({ length: blockSize }, () => (Math.random() - 0.5) * 0.2)
  console.log('Before:', audio.slice(0, 4))

  // Enhances in place, so the caller's array holds the result afterwards.
  processor.process(audio)
  console.log('After: ', audio.slice(0, 4))

  // Clear internal state on a stream discontinuity or seek.
  context.reset()

  // Ends the telemetry session now rather than waiting for garbage collection. The
  // processor cannot process audio afterwards.
  processor.terminateSession()
  console.log('\nEnhancement example completed successfully')
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
