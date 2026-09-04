import test from 'ava'

import {
  Analyzer,
  Model,
  Processor,
  ProcessorAsync,
  ProcessorParameter,
  Vad,
  VadAsync,
  VadParameter,
  getCompatibleModelVersion,
  getVersion,
} from '../index.js'
import { licenseKey, modelPath } from './common.js'
import { TEST_MODELS, TEST_MODEL_VERSION } from './models.js'

const enhancementModel = () => Model.fromFile(modelPath('enhancement'))
const vadModel = () => Model.fromFile(modelPath('vad'))
const analysisModel = () => Model.fromFile(modelPath('analysis'))

/** An initialized processor at the model's optimal settings, plus that block size. */
function initializedProcessor() {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const processor = new Processor(model, licenseKey())
  processor.initialize(sampleRate, blockSize)

  return { processor, blockSize }
}

test('sdk reports a version', (t) => {
  t.regex(getVersion(), /^\d+\.\d+\.\d+/)
})

test('sdk expects the model version the fixtures are published under', (t) => {
  // Guards against the fixture ids in models.ts drifting from the addon's expectation,
  // which would otherwise surface as a confusing "model version unsupported" much later.
  t.is(getCompatibleModelVersion(), TEST_MODEL_VERSION)
})

test('model exposes its id and optimal settings', (t) => {
  const model = enhancementModel()

  // The model file's own id carries the build hash and version, e.g.
  // `quail-vf-2.2-s-16khz-gf70x7zf-v14`, so it extends the manifest id used to download it.
  t.true(
    model.getId().startsWith(TEST_MODELS.enhancement.id),
    `expected ${model.getId()} to start with ${TEST_MODELS.enhancement.id}`,
  )
  t.true(model.getOptimalSampleRate() >= 8000)

  const blockSize = model.getOptimalBlockSize(model.getOptimalSampleRate())
  t.true(blockSize > 0)
  // Must be a plain number, not a BigInt: the SDK reports sizes as usize, and a BigInt
  // would throw on `new Float32Array(blockSize)`.
  t.is(typeof blockSize, 'number')
  t.is(new Float32Array(blockSize).length, blockSize)
})

test('optimal block size scales with sample rate', (t) => {
  const model = enhancementModel()

  // A model works on a fixed time window, so a higher rate needs proportionally more samples.
  t.true(model.getOptimalBlockSize(48000) > model.getOptimalBlockSize(16000))
})

test('model download resolves to a path without blocking the event loop', async (t) => {
  let ticks = 0
  const ticker = setInterval(() => {
    ticks += 1
  }, 1)

  try {
    const path = await Model.download(TEST_MODELS.enhancement.id, 'target')
    t.true(path.endsWith('.aicmodel'))
  } finally {
    clearInterval(ticker)
  }

  // A blocking download would starve the timer and leave this at 0.
  t.true(ticks > 0, 'event loop kept running during the download')
})

test('processor enhances audio in place', (t) => {
  const { processor, blockSize } = initializedProcessor()

  // Ramp rather than silence, so an in-place write is visible.
  const audio = Float32Array.from({ length: blockSize }, (_, i) => Math.sin(i / 10) * 0.5)
  const original = audio.slice()

  t.notThrows(() => processor.process(audio))
  t.notDeepEqual(Array.from(audio), Array.from(original), 'process should write into the caller buffer')
})

test('processor rejects a short block unless variable block size is enabled', (t) => {
  const { processor, blockSize } = initializedProcessor()

  processor.process(new Float32Array(blockSize))
  t.throws(() => processor.process(new Float32Array(20)))
})

test('processor accepts a short block when variable block size is enabled', (t) => {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const processor = new Processor(model, licenseKey())
  processor.initialize(sampleRate, blockSize, true)

  t.notThrows(() => processor.process(new Float32Array(blockSize)))
  t.notThrows(() => processor.process(new Float32Array(20)))
})

test('processor rejects processing before initialize', (t) => {
  const processor = new Processor(enhancementModel(), licenseKey())

  t.throws(() => processor.process(new Float32Array(160)))
})

test('processor context round-trips parameters and reports delay', (t) => {
  const { processor } = initializedProcessor()
  const context = processor.getContext()

  // Parameters are stored as f32 in the SDK, and 0.8 is not exactly representable in
  // f32, so the read-back widens to 0.800000011920929. Math.fround applies the same
  // rounding, keeping the assertion exact.
  context.setParameter(ProcessorParameter.EnhancementLevel, 0.8)
  t.is(context.getParameter(ProcessorParameter.EnhancementLevel), Math.fround(0.8))

  context.setParameter(ProcessorParameter.Bypass, 1)
  t.is(context.getParameter(ProcessorParameter.Bypass), 1)

  t.true(context.getAudioDelay() > 0)
  t.is(typeof context.getAudioDelay(), 'number')
  t.notThrows(() => context.reset())
})

test('processor context rejects an out-of-range parameter', (t) => {
  const { processor } = initializedProcessor()

  t.throws(() => processor.getContext().setParameter(ProcessorParameter.EnhancementLevel, 7))
})

/** A ramp rather than silence, so that processing has a visible effect. */
function ramp(length: number) {
  return Float32Array.from({ length }, (_, i) => Math.sin(i / 10) * 0.5)
}

test('async processor enhances audio without touching the caller buffer', async (t) => {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const processor = await new ProcessorAsync(model, licenseKey()).withConfig(sampleRate, blockSize)

  const audio = ramp(blockSize)
  const original = audio.slice()
  const enhanced = await processor.process(audio)

  // Unlike the sync class, the input is copied before the work is queued.
  t.deepEqual(Array.from(audio), Array.from(original), 'process must not write into the input')
  t.is(enhanced.length, blockSize)
  t.notDeepEqual(Array.from(enhanced), Array.from(original), 'process should return enhanced samples')
})

test('async processor matches the sync processor sample for sample', async (t) => {
  const { processor: syncProcessor, blockSize } = initializedProcessor()

  const model = enhancementModel()
  const asyncProcessor = await new ProcessorAsync(model, licenseKey()).withConfig(
    model.getOptimalSampleRate(),
    model.getOptimalBlockSize(model.getOptimalSampleRate()),
  )

  // Same model, same settings, same input, and both start from a fresh state: moving the
  // work to a worker thread and copying the block across must not change a single sample.
  // Several blocks, so a divergence in the processor's internal state would show up too.
  for (let block = 0; block < 4; block += 1) {
    const audio = ramp(blockSize)
    const expected = audio.slice()
    syncProcessor.process(expected)

    t.deepEqual(Array.from(await asyncProcessor.process(audio)), Array.from(expected), `block ${block} should match`)
  }
})

test('async processor keeps the event loop responsive', async (t) => {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)
  const processor = await new ProcessorAsync(model, licenseKey()).withConfig(sampleRate, blockSize)

  let ticks = 0
  const ticker = setInterval(() => {
    ticks += 1
  }, 1)

  try {
    let audio = ramp(blockSize)
    for (let block = 0; block < 200; block += 1) {
      audio = await processor.process(audio)
    }
  } finally {
    clearInterval(ticker)
  }

  // Processing on the JS thread would starve the timer and leave this at 0.
  t.true(ticks > 0, 'event loop kept running during processing')
})

test('async processors on separate instances can run concurrently', async (t) => {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  // Parallelism is across instances, never within one: libuv completes work items out of
  // order, so overlapping calls on a single instance would desync the stream.
  const processors = await Promise.all(
    Array.from({ length: 4 }, () => new ProcessorAsync(model, licenseKey()).withConfig(sampleRate, blockSize)),
  )

  const results = await Promise.all(processors.map((processor) => processor.process(ramp(blockSize))))

  // Every instance holds its own state, so identical input must give identical output.
  for (const result of results) {
    t.is(result.length, blockSize)
    t.deepEqual(Array.from(result), Array.from(results[0]), 'independent instances should agree')
  }
})

test('async processor rejects instead of throwing', async (t) => {
  const processor = new ProcessorAsync(enhancementModel(), licenseKey())

  // Errors surface as a rejected promise, not a synchronous throw.
  await t.throwsAsync(processor.process(new Float32Array(160)), undefined, 'processing before initialize should reject')
})

test('async processor context controls a live processor', async (t) => {
  const model = enhancementModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)
  const processor = await new ProcessorAsync(model, licenseKey()).withConfig(sampleRate, blockSize)

  // The handle itself is awaited, but its methods are synchronous, so it stays usable
  // from inside an audio callback.
  const context = await processor.getContext()
  // f32-backed parameter: see the note in 'processor context round-trips parameters'.
  context.setParameter(ProcessorParameter.EnhancementLevel, 0.8)
  t.is(context.getParameter(ProcessorParameter.EnhancementLevel), Math.fround(0.8))
  t.true(context.getAudioDelay() > 0)

  await processor.process(new Float32Array(blockSize))
  t.notThrows(() => context.reset())
})

test('async vad hands the block back unmodified and reports no speech for silence', async (t) => {
  const model = vadModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const vad = await new VadAsync(model, licenseKey()).withConfig(sampleRate, blockSize)
  const context = await vad.getContext()

  t.true(context.getPredictionDelay() > 0)

  const audio = ramp(blockSize)
  const returned = await vad.process(audio)
  t.deepEqual(Array.from(returned), Array.from(audio), 'vad must return its input unmodified')

  await vad.process(new Float32Array(blockSize))
  t.false(context.isSpeechDetected(), 'silence must not be reported as speech')
  t.true(context.getRawVadProbability() >= 0 && context.getRawVadProbability() <= 1)
})

test('vad reports no speech for silence and leaves audio untouched', (t) => {
  const model = vadModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const vad = new Vad(model, licenseKey())
  vad.initialize(sampleRate, blockSize)
  const context = vad.getContext()

  t.true(context.getPredictionDelay() > 0)

  const audio = Float32Array.from({ length: blockSize }, (_, i) => Math.sin(i / 10) * 0.5)
  const original = audio.slice()
  vad.process(audio)

  t.deepEqual(Array.from(audio), Array.from(original), 'vad must not modify its input')

  vad.process(new Float32Array(blockSize))
  t.false(context.isSpeechDetected(), 'silence must not be reported as speech')
  t.true(context.getRawVadProbability() >= 0 && context.getRawVadProbability() <= 1)
  t.notThrows(() => context.reset())
})

test('vad context round-trips parameters', (t) => {
  const vad = new Vad(vadModel(), licenseKey())
  const context = vad.getContext()

  context.setParameter(VadParameter.Sensitivity, 0.5)
  t.is(context.getParameter(VadParameter.Sensitivity), 0.5)

  // Sensitivity is a probability threshold, so it is capped at 1.0.
  t.throws(() => context.setParameter(VadParameter.Sensitivity, 7))
})

test('analyzer scores buffered audio', (t) => {
  const model = analysisModel()
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const analyzer = new Analyzer(model, licenseKey())
  analyzer.initialize(sampleRate, blockSize)
  analyzer.buffer(new Float32Array(blockSize))

  const result = analyzer.analyze()

  for (const [name, score] of Object.entries(result)) {
    t.is(typeof score, 'number', `${name} should be a number`)
    t.true(score >= 0 && score <= 1, `${name} should be within 0..=1, got ${score}`)
  }

  // All seven documented scores must be present.
  t.deepEqual(Object.keys(result).sort(), [
    'codecDegradation',
    'interferingSpeech',
    'noise',
    'packetLoss',
    'riskScore',
    'speakerLoudness',
    'speakerReverb',
  ])

  t.notThrows(() => analyzer.reset())
})

/** An initialized analyzer with a span of audio already buffered, plus that block size. */
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

test('async analysis returns the same scores as the blocking call', async (t) => {
  const { analyzer } = bufferedAnalyzer()

  // Same buffered audio and no state change between the two, so the worker thread must
  // produce exactly what the calling thread does.
  const expected = analyzer.analyze()
  const actual = await analyzer.analyzeAsync()

  t.deepEqual(actual, expected)
  t.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort())
  for (const [name, score] of Object.entries(actual)) {
    t.is(typeof score, 'number', `${name} should be a number`)
  }
})

test('async analysis keeps the event loop responsive', async (t) => {
  const { analyzer } = bufferedAnalyzer()

  let ticks = 0
  const ticker = setInterval(() => {
    ticks += 1
  }, 1)

  try {
    // Several rounds, so the test does not hinge on one analysis outrunning the timer.
    for (let round = 0; round < 20; round += 1) {
      await analyzer.analyzeAsync()
    }
  } finally {
    clearInterval(ticker)
  }

  t.true(ticks > 0, 'event loop kept running during analysis')
})

test('audio can be buffered while an analysis is in flight', async (t) => {
  const { analyzer, audio } = bufferedAnalyzer()

  // The point of holding only the analyzer half behind the lock: `buffer` drives the
  // collector, so it neither waits on a running analysis nor throws.
  const pending = analyzer.analyzeAsync()

  t.notThrows(() => {
    for (let block = 0; block < 50; block += 1) {
      analyzer.buffer(audio)
    }
  }, 'buffer must stay callable while analyzing')

  const result = await pending
  t.is(typeof result.riskScore, 'number')
})

// Errors from an async call surfacing as a rejection rather than a throw is covered by
// 'async processor rejects instead of throwing', which has a known error to trigger. The
// analyzer has no equally certain one. Whether analyzing before initialize errors or just
// returns silence-padded scores is unverified, so it is not asserted here.

test('each class rejects the wrong model type', (t) => {
  const key = licenseKey()

  t.throws(() => new Vad(enhancementModel(), key), undefined, 'Vad should reject an enhancement model')
  t.throws(() => new Processor(vadModel(), key), undefined, 'Processor should reject a VAD model')
  t.throws(() => new Analyzer(enhancementModel(), key), undefined, 'Analyzer should reject an enhancement model')

  // The async classes construct synchronously, so a wrong model throws here too rather
  // than rejecting later.
  t.throws(() => new VadAsync(enhancementModel(), key), undefined, 'VadAsync should reject an enhancement model')
  t.throws(() => new ProcessorAsync(vadModel(), key), undefined, 'ProcessorAsync should reject a VAD model')
})

test('loading a missing model file throws', (t) => {
  t.throws(() => Model.fromFile('does-not-exist.aicmodel'))
})

test('removed pre-rewrite API is absent', async (t) => {
  // The rewrite dropped these exports. Asserting the old names are gone keeps the migration
  // guide in the CHANGELOG honest, and catches an accidental re-introduction.
  const sdk = (await import('../index.js')) as Record<string, unknown>

  for (const removed of ['analyzerPair', 'Collector', 'OtelConfig', 'FileAnalyzer']) {
    t.is(sdk[removed], undefined, `${removed} should no longer be exported`)
  }
})
