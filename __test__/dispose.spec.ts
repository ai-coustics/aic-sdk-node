import test from 'ava'

import { Model, Processor, ProcessorAsync, Vad, VadAsync } from '../index.js'
import { licenseKey, modelPath } from './common.js'

const enhancementModel = () => Model.fromFile(modelPath('enhancement'))
const vadModel = () => Model.fromFile(modelPath('vad'))

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

  // Dispose is idempotent: a second call does nothing and must not throw.
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
  vad.dispose()

  t.throws(() => vad.process(new Float32Array(160)), { message: /disposed/ })
  t.throws(() => vad.getContext(), { message: /disposed/ })
  vad.dispose()
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
  await processor.dispose()

  await t.throwsAsync(() => processor.process(new Float32Array(blockSize)), {
    message: /disposed/,
  })
  await t.throwsAsync(() => processor.terminateSession(), { message: /disposed/ })
  await processor.dispose()
  t.pass()
})

test('async vad dispose rejects later use', async (t) => {
  const model = vadModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const vad = new VadAsync(model, licenseKey())
  await vad.initialize(sampleRate, blockSize)
  await vad.dispose()

  await t.throwsAsync(() => vad.process(new Float32Array(blockSize)), { message: /disposed/ })
  t.pass()
})

test('a withConfig handle outlives its original handle being collected', async (t) => {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  // The chaining form leaves the constructor's handle as garbage. Its finalizer must
  // give back only its own claim, not destroy the shared native processor.
  let processor = await new ProcessorAsync(model, licenseKey()).withConfig(sampleRate, blockSize)

  // Encourage a GC so the dropped handle's finalizer runs.
  const churn: unknown[] = []
  for (let i = 0; i < 10_000; i++) churn.push({ i })
  churn.length = 0
  if (typeof global.gc === 'function') global.gc()
  await new Promise((resolve) => setImmediate(resolve))

  const block = new Float32Array(blockSize)
  await processor.process(block)
  await processor.dispose()
  processor = undefined as unknown as ProcessorAsync
  t.pass()
})
