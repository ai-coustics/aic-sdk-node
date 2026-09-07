// Speech enhancement on Node's libuv thread pool.
//
// `process` copies its input and returns a promise for the enhanced samples.
// `getContext` returns a promise; the context's methods are synchronous.
// The final example processes several independent streams concurrently.

const os = require('node:os')

const { Model, ProcessorAsync, ProcessorParameter, getCompatibleModelVersion, getVersion } = require('..')

const MODEL_ID = 'quail-vf-2.2-s-16khz'
const MODEL_DIR = './models'
const BLOCKS = 100
const STREAMS = 4

async function main() {
  const licenseKey = process.env.AIC_SDK_LICENSE
  if (!licenseKey) {
    console.error('Error: AIC_SDK_LICENSE environment variable not set')
    console.error('Get your license key from https://developers.ai-coustics.com')
    process.exit(1)
  }

  console.log('SDK version:', getVersion())
  console.log('Compatible model version:', getCompatibleModelVersion())

  const modelPath = await Model.download(MODEL_ID, MODEL_DIR)
  const model = Model.fromFile(modelPath)
  console.log('Model id:', model.getId())

  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)
  console.log(`Audio format: ${blockSize} samples @ ${sampleRate} Hz`)

  // Create and initialize the processor. Calling `initialize` on a constructed
  // instance is equivalent.
  const processor = await new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)

  const context = await processor.getContext()
  console.log('Audio delay:', context.getAudioDelay(), 'samples')

  // Context methods are synchronous and can be used during processing.
  context.setParameter(ProcessorParameter.EnhancementLevel, 0.7)
  console.log('Enhancement level:', context.getParameter(ProcessorParameter.EnhancementLevel))

  // Count event-loop timer callbacks during processing.
  let ticks = 0
  const ticker = setInterval(() => {
    ticks += 1
  }, 1)

  // Await each block in sequence. The result is a new array; the input is unmodified.
  let audio = Float32Array.from({ length: blockSize }, () => (Math.random() - 0.5) * 0.2)
  console.log('Before:', audio.slice(0, 4))

  const started = performance.now()
  for (let block = 0; block < BLOCKS; block += 1) {
    audio = await processor.process(audio)
  }
  const elapsed = performance.now() - started

  clearInterval(ticker)

  console.log('After: ', audio.slice(0, 4))

  const audioMs = (BLOCKS * blockSize * 1000) / sampleRate
  console.log(`\nProcessed ${BLOCKS} blocks (${audioMs.toFixed(0)} ms of audio) in ${elapsed.toFixed(0)} ms`)
  console.log(`Real-time factor: ${(audioMs / elapsed).toFixed(1)}x`)
  // Report how many timer callbacks ran during processing.
  console.log(`Timer fired ${ticks} times while processing, so the event loop stayed responsive`)

  // Process independent streams concurrently, with one processor per stream.
  // Await calls within each stream to preserve block order.
  console.log(`\nEnhancing ${STREAMS} streams concurrently`)

  const processors = await Promise.all(
    Array.from({ length: STREAMS }, () => new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)),
  )

  const concurrentStart = performance.now()
  await Promise.all(
    processors.map(async (instance) => {
      // Sequential within a stream, concurrent across them.
      let block = new Float32Array(blockSize)
      for (let i = 0; i < BLOCKS; i += 1) {
        block = await instance.process(block)
      }
    }),
  )
  const concurrentElapsed = performance.now() - concurrentStart

  // Concurrency is limited by the libuv pool size, configured with UV_THREADPOOL_SIZE.
  console.log(`${STREAMS} x ${BLOCKS} blocks in ${concurrentElapsed.toFixed(0)} ms`)
  console.log(`Aggregate: ${((STREAMS * audioMs) / concurrentElapsed).toFixed(1)}x real time`)
  console.log(`libuv pool: ${process.env.UV_THREADPOOL_SIZE ?? '4 (default)'}, ${os.cpus().length} logical CPUs`)

  await Promise.all([processor.terminateSession(), ...processors.map((instance) => instance.terminateSession())])
  console.log('\nAsync enhancement example completed successfully')
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
