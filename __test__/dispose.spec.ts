import test from 'ava'

import { Analyzer, Model, Processor, ProcessorAsync, Vad, VadAsync } from '../index.js'
import { licenseKey, modelPath } from './common.js'

const enhancementModel = () => Model.fromFile(modelPath('enhancement'))
const vadModel = () => Model.fromFile(modelPath('vad'))
const analysisModel = () => Model.fromFile(modelPath('analysis'))

/** An initialized analyzer with a span of audio already buffered. */
function bufferedAnalyzer() {
  const model = analysisModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const analyzer = new Analyzer(model, licenseKey())
  analyzer.initialize(sampleRate, blockSize)

  const audio = Float32Array.from({ length: blockSize }, (_, i) => Math.sin(i / 10) * 0.5)
  for (let block = 0; block < 100; block += 1) {
    analyzer.buffer(audio)
  }

  return { analyzer, audio, blockSize }
}

/** Milliseconds since a `process.hrtime.bigint()` reading. */
function elapsedMs(since: bigint): number {
  return Number(process.hrtime.bigint() - since) / 1e6
}

/** Holds the calling thread for `ms`, leaving worker threads free to run. */
function spin(ms: number) {
  const until = process.hrtime.bigint() + BigInt(Math.round(ms * 1e6))
  while (process.hrtime.bigint() < until) {
    // Busy on purpose. Yielding to the event loop, or waiting on a timer, would let the
    // analysis finish before dispose() is called.
  }
}

/** An initialized processor at the model's optimal settings, plus that block size. */
function initializedProcessor() {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const processor = new Processor(model, licenseKey())
  processor.initialize(sampleRate, blockSize)

  return { processor, sampleRate, blockSize, model }
}

test('sync processor dispose releases memory and rejects later use', (t) => {
  const { processor, blockSize, model } = initializedProcessor()
  processor.dispose()

  t.throws(() => processor.process(new Float32Array(blockSize)), { message: /disposed/ })
  t.throws(() => processor.initialize(16000, blockSize), { message: /disposed/ })
  t.throws(() => processor.getContext(), { message: /disposed/ })
  t.throws(() => processor.terminateSession(), { message: /disposed/ })

  // Idempotent: a second dispose() must not throw.
  processor.dispose()

  // The model stays usable after one of its processors is disposed.
  const second = new Processor(model, licenseKey())
  second.dispose()
  t.pass()
})

test('sync vad dispose releases memory and rejects later use', (t) => {
  const model = vadModel()
  const vad = new Vad(model, licenseKey())
  vad.initialize(model.getOptimalSampleRate(), model.getOptimalBlockSize(model.getOptimalSampleRate()))
  const context = vad.getContext()
  vad.dispose()

  t.throws(() => vad.process(new Float32Array(160)), { message: /disposed/ })
  t.throws(() => vad.getContext(), { message: /disposed/ })
  vad.dispose()

  // The SDK guarantees a VAD context stays valid after its VAD is destroyed
  // (the prediction just stops updating), so using it must not crash.
  context.isSpeechDetected()
  t.pass()
})

test('model dispose rejects later use but keeps created processors working', (t) => {
  const model = enhancementModel()
  const { processor, blockSize } = initializedProcessorOn(model)
  model.dispose()

  t.throws(() => model.getId(), { message: /disposed/ })
  t.throws(() => model.getOptimalSampleRate(), { message: /disposed/ })

  // The SDK reference-counts the weights, so the processor keeps working.
  processor.process(new Float32Array(blockSize))
  t.pass()

  function initializedProcessorOn(model: Model) {
    const sampleRate = model.getOptimalSampleRate()
    const blockSize = model.getOptimalBlockSize(sampleRate)
    const processor = new Processor(model, licenseKey())
    processor.initialize(sampleRate, blockSize)
    return { processor, blockSize }
  }
})

test('async processor dispose rejects later use and is idempotent', async (t) => {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const processor = new ProcessorAsync(model, licenseKey())
  await processor.initialize(sampleRate, blockSize)
  processor.dispose()

  await t.throwsAsync(() => processor.process(new Float32Array(blockSize)), {
    message: /disposed/,
  })
  await t.throwsAsync(() => processor.terminateSession(), { message: /disposed/ })
  processor.dispose()
  t.pass()
})

test('async vad dispose rejects later use', async (t) => {
  const model = vadModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const vad = new VadAsync(model, licenseKey())
  await vad.initialize(sampleRate, blockSize)
  vad.dispose()

  await t.throwsAsync(() => vad.process(new Float32Array(blockSize)), { message: /disposed/ })
  t.pass()
})

test('analyzer dispose rejects later use and is idempotent', async (t) => {
  const model = analysisModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const analyzer = new Analyzer(model, licenseKey())
  analyzer.initialize(sampleRate, blockSize)
  analyzer.buffer(new Float32Array(blockSize))
  analyzer.dispose()

  t.throws(() => analyzer.buffer(new Float32Array(blockSize)), { message: /disposed/ })
  t.throws(() => analyzer.analyze(), { message: /disposed/ })
  await t.throwsAsync(() => analyzer.analyzeAsync(), { message: /disposed/ })

  // Idempotent: a second dispose() must not throw.
  analyzer.dispose()
  t.pass()
})

test('analyzer dispose racing an analyzeAsync settles it without crashing', async (t) => {
  const { analyzer } = bufferedAnalyzer()

  // Disposing in the same tick leaves it undecided which side reaches the lock first, so
  // the promise may resolve or reject and neither outcome is asserted. The next test
  // covers the case where dispose() does block.
  const inFlight = analyzer.analyzeAsync().catch(() => {})
  analyzer.dispose()
  await inFlight

  t.throws(() => analyzer.analyze(), { message: /disposed/ })
  t.pass()
})

test('analyzer dispose waits for an in-flight analyzeAsync to finish', async (t) => {
  const { analyzer } = bufferedAnalyzer()

  // Time a warm analysis so the thresholds below scale to this machine. The first run
  // pays any lazy setup, so the second is the estimate.
  await analyzer.analyzeAsync()
  const calibrationStarted = process.hrtime.bigint()
  await analyzer.analyzeAsync()
  const analysisMs = elapsedMs(calibrationStarted)

  // Hand the task to libuv and let the worker take the analyzer lock. It spins rather
  // than waiting on a timer, whose granularity could overshoot the whole analysis and
  // leave dispose() with nothing to wait for.
  const inFlight = analyzer.analyzeAsync()
  await new Promise((resolve) => setImmediate(resolve))
  spin(Math.min(analysisMs / 8, 5))

  const disposeStarted = process.hrtime.bigint()
  analyzer.dispose()
  const blockedMs = elapsedMs(disposeStarted)

  // The worker completed analysis before disposal acquired the lock.
  const result = await inFlight
  t.is(typeof result.riskScore, 'number', 'the in-flight analysis must complete, not be cancelled')

  // The analysis was still running when dispose() was called, so the wait above was the
  // lock being held, not a no-op on an already-finished analysis.
  t.true(
    blockedMs >= analysisMs / 4,
    `dispose() blocked ${blockedMs.toFixed(1)}ms of a ~${analysisMs.toFixed(1)}ms analysis`,
  )

  t.throws(() => analyzer.analyze(), { message: /disposed/ })
})

test('a withConfig handle outlives its original handle being collected', async (t) => {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  // The constructor's temporary handle may be finalized after `withConfig` resolves.
  // Its finalizer must preserve the shared processor and its single memory report.
  const processor = await new ProcessorAsync(model, licenseKey()).withConfig(sampleRate, blockSize)

  // Push V8 towards a GC so the dropped handle's finalizer runs.
  const churn: unknown[] = []
  for (let i = 0; i < 10_000; i++) churn.push({ i })
  churn.length = 0
  if (typeof global.gc === 'function') global.gc()
  await new Promise((resolve) => setImmediate(resolve))

  const block = new Float32Array(blockSize)
  await processor.process(block)
  processor.dispose()
  t.pass()
})
