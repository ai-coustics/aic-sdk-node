import os from 'node:os'

import { Bench } from 'tinybench'

import { Analyzer, Model, Processor, ProcessorAsync } from '../index.js'

const licenseKey = process.env.AIC_SDK_LICENSE
if (!licenseKey) {
  throw new Error('AIC_SDK_LICENSE environment variable must be set to run the benchmark')
}

const modelPath = process.env.AIC_SDK_MODEL
if (!modelPath) {
  throw new Error(
    'AIC_SDK_MODEL must point to a .aicmodel file. Run "pnpm pretest" to download the ' +
      'test fixtures, then point it at one of the files in __test__/data.',
  )
}

const model = Model.fromFile(modelPath)
const sampleRate = model.getOptimalSampleRate()
const blockSize = model.getOptimalBlockSize(sampleRate)

const processor = new Processor(model, licenseKey)
processor.initialize(sampleRate, blockSize)

// Number of concurrent streams. Each needs an independent processor to preserve block order.
const concurrency = Number(process.env.AIC_BENCH_CONCURRENCY ?? 4)

const asyncProcessor = await new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)
const asyncProcessors = await Promise.all(
  Array.from({ length: concurrency }, () => new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)),
)

// Reuse a reference signal to exclude input allocation from the measurement.
const audio = Float32Array.from({ length: blockSize }, (_, i) => Math.sin(i / 10) * 0.5)

// Refill the synchronous processor's scratch buffer before each iteration.
// This prevents enhanced output from becoming the next iteration's input.
const syncAudio = new Float32Array(blockSize)

// Keep a separate result buffer for each async stream.
const asyncAudio = asyncProcessors.map(() => audio.slice())

const syncTask = `sync: 1 block`
const asyncTask = `async: 1 block`
const concurrentTask = `async: ${concurrency} blocks concurrently`

// Track blocks per iteration to normalize throughput across benchmark cases.
const blocksPerIteration = new Map([
  [syncTask, 1],
  [asyncTask, 1],
  [concurrentTask, concurrency],
])

const bench = new Bench()

bench.add(
  syncTask,
  () => {
    processor.process(syncAudio)
  },
  // Hooks run outside the measurement, so the refill does not count towards the timing.
  { beforeEach: () => syncAudio.set(audio) },
)

// Measure async scheduling, promise and input-copy overhead relative to synchronous processing.
bench.add(asyncTask, async () => {
  await asyncProcessor.process(audio)
})

// The throughput case: one processor per stream, all in flight at once. Bounded by the
// libuv pool, which is 4 threads unless UV_THREADPOOL_SIZE says otherwise.
bench.add(concurrentTask, async () => {
  await Promise.all(asyncProcessors.map((instance, stream) => instance.process(asyncAudio[stream])))
})

// Benchmark analysis separately when an analysis model is supplied.
// Analysis processes a fixed duration of buffered audio per call.
const analysisModelPath = process.env.AIC_SDK_ANALYSIS_MODEL
if (analysisModelPath) {
  const analysisModel = Model.fromFile(analysisModelPath)
  const analysisRate = analysisModel.getOptimalSampleRate()
  const analysisBlock = analysisModel.getOptimalBlockSize(analysisRate)

  const analyzer = new Analyzer(analysisModel, licenseKey)
  analyzer.initialize(analysisRate, analysisBlock)

  // The model consumes a fixed span, so fill it before measuring. `analyze` does not consume
  // the buffer, so one fill serves every iteration.
  const analysisAudio = Float32Array.from({ length: analysisBlock }, (_, i) => Math.sin(i / 10) * 0.5)
  for (let block = 0; block < 200; block += 1) {
    analyzer.buffer(analysisAudio)
  }

  bench.add('analysis: analyze (blocking)', () => {
    analyzer.analyze()
  })

  // Measure async scheduling overhead relative to synchronous analysis.
  bench.add('analysis: analyzeAsync', async () => {
    await analyzer.analyzeAsync()
  })
} else {
  console.info('Set AIC_SDK_ANALYSIS_MODEL to a Tyto model to include analysis in this run.\n')
}

await bench.run()

console.info(
  `${os.cpus().length} logical CPUs, libuv pool ${process.env.UV_THREADPOOL_SIZE ?? '4 (default)'}, ` +
    `${blockSize} samples @ ${sampleRate} Hz`,
)
console.table(bench.table())

// A block covers blockSize / sampleRate seconds of audio. The ratio of that to the mean
// time per block is the real-time factor: how many streams the machine could keep up with.
// Only a completed run carries statistics; aborted, errored and not-started ones do not.
const blockDurationMs = (blockSize / sampleRate) * 1000
for (const task of bench.tasks) {
  const blocks = blocksPerIteration.get(task.name)
  const result = task.result

  // Only the per-block enhancement tasks are in the map. Analysis works over a span rather
  // than a block, so a real-time factor would not mean anything for it.
  if (blocks && result?.state === 'completed' && result.latency.mean > 0) {
    const perBlock = result.latency.mean / blocks
    console.info(`${task.name} — real-time factor: ${(blockDurationMs / perBlock).toFixed(1)}x`)
  }
}
