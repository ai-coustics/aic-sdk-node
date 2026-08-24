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

// How many streams the concurrent case runs at once. Parallelism is across instances,
// never within one, so each stream gets its own processor.
const concurrency = Number(process.env.AIC_BENCH_CONCURRENCY ?? 4)

const asyncProcessor = await new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)
const asyncProcessors = await Promise.all(
  Array.from({ length: concurrency }, () => new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)),
)

// One block of speech-like content, reused so the benchmark measures processing rather
// than buffer allocation.
const audio = Float32Array.from({ length: blockSize }, (_, i) => Math.sin(i / 10) * 0.5)

// The async calls resolve to a fresh array each time rather than writing in place, so each
// stream keeps its own block to hand back in.
const asyncAudio = asyncProcessors.map(() => audio.slice())

const syncTask = `sync: 1 block`
const asyncTask = `async: 1 block`
const concurrentTask = `async: ${concurrency} blocks concurrently`

// Blocks of audio each iteration gets through, so the real-time factor below can compare
// the one-block cases against the concurrent one on equal terms.
const blocksPerIteration = new Map([
  [syncTask, 1],
  [asyncTask, 1],
  [concurrentTask, concurrency],
])

const bench = new Bench()

bench.add(syncTask, () => {
  processor.process(audio)
})

// Same work as above on a worker thread, so the gap against `sync` is the cost of the
// promise plus the copy in and out.
bench.add(asyncTask, async () => {
  await asyncProcessor.process(audio)
})

// The throughput case: one processor per stream, all in flight at once. Bounded by the
// libuv pool, which is 4 threads unless UV_THREADPOOL_SIZE says otherwise.
bench.add(concurrentTask, async () => {
  await Promise.all(asyncProcessors.map((instance, stream) => instance.process(asyncAudio[stream])))
})

// Analysis, if an analysis model was supplied. Measured separately from enhancement because
// `analyzeBuffered` is an occasional call over a span of audio rather than a per-block one, so its
// cost is what decides whether `analyzeAsync` is worth reaching for at all: anything in the
// tens of milliseconds is far too long to sit on the event loop.
const analysisModelPath = process.env.AIC_SDK_ANALYSIS_MODEL
if (analysisModelPath) {
  const analysisModel = Model.fromFile(analysisModelPath)
  const analysisRate = analysisModel.getOptimalSampleRate()
  const analysisBlock = analysisModel.getOptimalBlockSize(analysisRate)

  const analyzer = new Analyzer(analysisModel, licenseKey)
  analyzer.initialize(analysisRate, analysisBlock)

  // The model consumes a fixed span, so fill it before measuring. `analyzeBuffered` does not consume
  // the buffer, so one fill serves every iteration.
  const analysisAudio = Float32Array.from({ length: analysisBlock }, (_, i) => Math.sin(i / 10) * 0.5)
  for (let block = 0; block < 200; block += 1) {
    analyzer.buffer(analysisAudio)
  }

  bench.add('analysis: analyzeBuffered (blocking)', () => {
    analyzer.analyzeBuffered()
  })

  // The gap against the blocking call is the promise plus the thread hop. Against a model
  // this size it should be lost in the noise.
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
