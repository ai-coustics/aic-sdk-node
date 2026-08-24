// Speech enhancement off the main thread.
//
// `ProcessorAsync` does the same work as `Processor`, but on a worker thread, so the event
// loop stays free. Two differences to watch for:
//
//   * `process` does not write into the caller's array. It copies the input, so the array
//     stays valid while the promise is pending, and resolves to the enhanced samples.
//   * `getContext()` is awaited, but the handle it resolves to is fully synchronous.
//
// It ends by running several streams at once, which is where the async API earns its keep.

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

  // `withConfig` initializes and resolves to a handle, so construction and setup chain into
  // one await. `new ProcessorAsync(...)` plus `await processor.initialize(...)` is equivalent.
  const processor = await new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)

  const context = await processor.getContext()
  console.log('Audio delay:', context.getAudioDelay(), 'samples')

  // Synchronous even on the async class, so parameters can be changed from anywhere,
  // including from inside an audio callback.
  context.setParameter(ProcessorParameter.EnhancementLevel, 0.7)
  console.log('Enhancement level:', context.getParameter(ProcessorParameter.EnhancementLevel))

  // A timer to prove the event loop is not blocked while the model runs.
  let ticks = 0
  const ticker = setInterval(() => {
    ticks += 1
  }, 1)

  // The steady-state streaming loop. `process` resolves to a new array, so the block is
  // reassigned rather than mutated; reusing one variable keeps this as tidy as the
  // synchronous version.
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
  // Zero here would mean the work had blocked the event loop.
  console.log(`Timer fired ${ticks} times while processing, so the event loop stayed responsive`)

  // Several streams at once.
  //
  // One instance handles one stream, and calls on it must not overlap: worker threads
  // finish out of order, so a second `process` before the first resolves would desync the
  // stream. Concurrency comes from running several instances side by side, one per stream,
  // as a server would do per connection.
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

  // Bounded by the libuv pool, four threads unless UV_THREADPOOL_SIZE says otherwise, so
  // raising it lets more streams overlap.
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
