const fs = require("fs");
const assert = require("assert");

const {
  Model,
  OtelConfig,
  Processor,
  ProcessorParameter,
  Vad,
  VadParameter,
  FileAnalyzer,
  analyzerPair,
} = require("..");
const {
  TEST_AUDIO_PATH,
  TEST_AUDIO_ENHANCED_PATH,
  VAD_RESULTS_PATH,
  getTestModelPath,
  getVadModelPath,
  getAnalysisModelPath,
  licenseKey,
  loadWavAudio,
  approxEqual,
} = require("./common");

/**
 * Tests audio enhancement by processing an entire mono file containing voice in a single pass.
 * Uses a non-optimal block size (full file length) to verify the internal block adapter handles
 * arbitrary input sizes correctly. Uses a reduced enhancement level (0.9) to exercise non-default
 * parameter paths. Compares output against a pre-generated reference file.
 */
function testProcessFullFile() {
  console.log("Running: testProcessFullFile");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getTestModelPath());

  const processor = new Processor(model, licenseKey());
  processor.initialize(audio.sampleRate, audio.sampleCount, false);

  const procCtx = processor.getContext();
  procCtx.setParameter(ProcessorParameter.EnhancementLevel, 0.9);

  const samples = new Float32Array(audio.samples);
  processor.process(samples);

  const expectedOutput = loadWavAudio(TEST_AUDIO_ENHANCED_PATH);

  let mismatchCount = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!approxEqual(samples[i], expectedOutput.samples[i], 1e-6)) {
      mismatchCount++;
      if (mismatchCount <= 5) {
        console.log(
          `  Sample mismatch at index ${i}: got ${samples[i]}, expected ${expectedOutput.samples[i]}`,
        );
      }
    }
  }

  assert.strictEqual(
    mismatchCount,
    0,
    `${mismatchCount} samples did not match expected output`,
  );
  processor.terminateSession();
  console.log("  PASSED");
}

/**
 * Tests dedicated VAD processing in optimal-size blocks against a deterministic reference.
 */
function testProcessBlocksWithVad() {
  console.log("Running: testProcessBlocksWithVad");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getVadModelPath());
  const blockSize = model.getOptimalBlockSize(audio.sampleRate);

  const vad = new Vad(model, licenseKey());
  vad.initialize(audio.sampleRate, blockSize, false);
  const vadContext = vad.getContext();

  assert(
    vadContext.getPredictionDelay() > 0,
    "VAD should report a prediction delay",
  );

  const samples = new Float32Array(audio.samples);
  const speechDetectedResults = [];
  const rawVadProbabilities = [];

  for (let offset = 0; offset + blockSize <= samples.length; offset += blockSize) {
    vad.process(samples.subarray(offset, offset + blockSize));
    speechDetectedResults.push(vadContext.isSpeechDetected());
    rawVadProbabilities.push(vadContext.rawVadProbability());
  }

  assert(
    rawVadProbabilities.every(
      (probability) => probability >= 0.0 && probability <= 1.0,
    ),
    "Raw VAD probabilities must be in the range 0.0 to 1.0",
  );

  const expectedResults = JSON.parse(
    fs.readFileSync(VAD_RESULTS_PATH, "utf8"),
  );
  assert.deepStrictEqual(
    speechDetectedResults,
    expectedResults,
    "VAD results do not match expected",
  );
  vad.terminateSession();
  console.log("  PASSED");
}

/**
 * Tests that resetting the VAD immediately clears its published prediction.
 */
function testVadResetClearsPublishedPrediction() {
  console.log("Running: testVadResetClearsPublishedPrediction");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getVadModelPath());
  const blockSize = model.getOptimalBlockSize(audio.sampleRate);

  const vad = new Vad(model, licenseKey());
  vad.initialize(audio.sampleRate, blockSize, false);
  const vadContext = vad.getContext();

  let speechWasDetected = false;
  for (let offset = 0; offset + blockSize <= audio.samples.length; offset += blockSize) {
    vad.process(audio.samples.subarray(offset, offset + blockSize));
    if (vadContext.isSpeechDetected()) {
      speechWasDetected = true;
      break;
    }
  }

  assert(speechWasDetected, "The test signal should contain detectable speech");

  vadContext.reset();
  assert.strictEqual(vadContext.isSpeechDetected(), false);
  assert.strictEqual(vadContext.rawVadProbability(), 0.0);
  console.log("  PASSED");
}

/**
 * Tests that processing before VAD initialization is rejected.
 */
function testVadRejectsProcessingBeforeInitialize() {
  console.log("Running: testVadRejectsProcessingBeforeInitialize");

  const model = Model.fromFile(getVadModelPath());
  const vad = new Vad(model, licenseKey());

  assert.throws(
    () => vad.process(new Float32Array(160)),
    /must be initialized/,
  );
  console.log("  PASSED");
}

/**
 * Tests VAD parameter round-tripping and the dedicated-model sensitivity range.
 */
function testVadParameters() {
  console.log("Running: testVadParameters");

  const model = Model.fromFile(getVadModelPath());
  const vad = new Vad(model, licenseKey(), OtelConfig.disabled());
  const vadContext = vad.getContext();

  vadContext.setParameter(VadParameter.Sensitivity, 0.5);
  assert.strictEqual(
    vadContext.getParameter(VadParameter.Sensitivity),
    0.5,
  );
  assert.throws(
    () => vadContext.setParameter(VadParameter.Sensitivity, 7.0),
    /outside the acceptable range/,
  );

  // This succeeds for JWT licenses and returns TokenUpdateUnsupported for other license types.
  try {
    vadContext.updateBearerToken(licenseKey());
  } catch (error) {
    assert.match(error.message, /token|JWT/i);
  }
  console.log("  PASSED");
}

/**
 * Tests that enhancement models cannot be used to create a dedicated VAD.
 */
function testVadRejectsEnhancementModel() {
  console.log("Running: testVadRejectsEnhancementModel");

  const model = Model.fromFile(getTestModelPath());
  assert.throws(
    () => new Vad(model, licenseKey()),
    /not supported by the requested API/,
  );
  console.log("  PASSED");
}

/**
 * Asserts that an analysis result has all expected fields in the valid 0.0 to 1.0 range.
 */
function assertValidAnalysisResult(result) {
  const fields = [
    "riskScore",
    "speakerReverb",
    "speakerLoudness",
    "interferingSpeech",
    "noise",
    "codecDegradation",
    "packetLoss",
  ];
  for (const field of fields) {
    assert.strictEqual(
      typeof result[field],
      "number",
      `Field ${field} should be a number`,
    );
    assert.ok(
      result[field] >= 0.0 && result[field] <= 1.0,
      `Field ${field} should be in range 0.0 to 1.0, got ${result[field]}`,
    );
  }
}

/**
 * Tests that FileAnalyzer returns a single padded result for audio shorter than the
 * five-second analysis window.
 */
function testFileAnalyzerShortAudio() {
  console.log("Running: testFileAnalyzerShortAudio");

  const model = Model.fromFile(getAnalysisModelPath());
  const analyzer = new FileAnalyzer(model, licenseKey());

  const sampleRate = 16000;
  const audio = new Float32Array(sampleRate); // 1 second, shorter than the 5s window
  const results = analyzer.analyze(audio, sampleRate);

  assert.strictEqual(results.length, 1, "Short audio should yield one result");
  assertValidAnalysisResult(results[0]);
  console.log("  PASSED");
}

/**
 * Tests that FileAnalyzer produces one result per complete five-second window when stepping
 * through a longer signal without overlap.
 */
function testFileAnalyzerWindowing() {
  console.log("Running: testFileAnalyzerWindowing");

  const model = Model.fromFile(getAnalysisModelPath());
  const analyzer = new FileAnalyzer(model, licenseKey());

  const sampleRate = 16000;
  // 12 seconds of low-level audio, stepping by the full 5s window (no overlap).
  const audio = new Float32Array(sampleRate * 12);
  for (let i = 0; i < audio.length; i++) {
    audio[i] = Math.sin(i * 0.05) * 0.1;
  }

  const stepSamples = sampleRate * 5;
  const results = analyzer.analyze(audio, sampleRate, stepSamples);

  // Windows start at 0 and 5s. (12 - 5) / 5 = 1 followup window -> 2 results total.
  assert.strictEqual(results.length, 2, "12s audio with 5s step should yield two results");
  for (const result of results) {
    assertValidAnalysisResult(result);
  }
  console.log("  PASSED");
}

/**
 * Tests analyzing audio through a Collector/Analyzer pair directly.
 */
function testAnalyzerPairDirect() {
  console.log("Running: testAnalyzerPairDirect");

  const model = Model.fromFile(getAnalysisModelPath());
  const { collector, analyzer } = analyzerPair(model, licenseKey());

  const sampleRate = 16000;
  const blockSize = model.getOptimalBlockSize(sampleRate);
  collector.initialize(sampleRate, blockSize, false);

  // Pass five seconds of silence to the collector in optimal-size blocks, then analyze.
  const audioBlock = new Float32Array(blockSize);
  for (
    let collectedSamples = 0;
    collectedSamples < sampleRate * 5;
    collectedSamples += blockSize
  ) {
    collector.buffer(audioBlock);
  }

  const result = analyzer.analyzeBuffered();
  assertValidAnalysisResult(result);

  // Reset should succeed and leave the collector initialized for reuse.
  analyzer.reset();
  analyzer.terminateSession();
  console.log("  PASSED");
}

/**
 * Tests that creating an analyzer pair with an enhancement model (not an analysis model)
 * surfaces the ModelTypeUnsupported error.
 */
function testAnalyzerRejectsNonAnalysisModel() {
  console.log("Running: testAnalyzerRejectsNonAnalysisModel");

  const model = Model.fromFile(getTestModelPath());

  assert.throws(
    () => analyzerPair(model, licenseKey()),
    /not supported by the requested API/,
    "Enhancement model should be rejected for analysis",
  );
  console.log("  PASSED");
}

/**
 * Tests that passing an audio block before the collector is initialized is rejected.
 */
function testCollectorRejectsBlockBeforeInitialize() {
  console.log("Running: testCollectorRejectsBlockBeforeInitialize");

  const model = Model.fromFile(getAnalysisModelPath());
  const { collector } = analyzerPair(model, licenseKey());

  assert.throws(
    () => collector.buffer(new Float32Array(4)),
    /must be initialized/,
  );
  console.log("  PASSED");
}

/**
 * Tests that the collector rejects audio blocks whose size does not match the initialized config.
 */
function testCollectorValidatesLayout() {
  console.log("Running: testCollectorValidatesLayout");

  const model = Model.fromFile(getAnalysisModelPath());
  const sampleRate = model.getOptimalSampleRate();
  const blockSize = model.getOptimalBlockSize(sampleRate);

  const { collector } = analyzerPair(model, licenseKey());
  collector.initialize(sampleRate, blockSize, false);

  // An audio block whose length differs from the initialized block size is rejected.
  assert.throws(
    () => collector.buffer(new Float32Array(blockSize - 1)),
    /differs from the one provided/,
  );
  console.log("  PASSED");
}

/**
 * Tests that a license key containing a NUL byte is rejected when creating an analyzer pair.
 */
function testAnalyzerPairRejectsLicenseWithNul() {
  console.log("Running: testAnalyzerPairRejectsLicenseWithNul");

  const model = Model.fromFile(getAnalysisModelPath());

  assert.throws(
    () => analyzerPair(model, "invalid\0license"),
    /format is invalid/,
  );
  console.log("  PASSED");
}

/**
 * Tests that variable block sizes are accepted when enabled and rejected when disabled.
 */
function testCollectorVariableBlockSize() {
  console.log("Running: testCollectorVariableBlockSize");

  const model = Model.fromFile(getAnalysisModelPath());
  const sampleRate = model.getOptimalSampleRate();
  const blockSize = model.getOptimalBlockSize(sampleRate);
  const fullBlock = new Float32Array(blockSize);
  const shortBlock = new Float32Array(20);

  // Disabled: a short audio block after a full one is rejected.
  const disabled = analyzerPair(model, licenseKey());
  disabled.collector.initialize(sampleRate, blockSize, false);
  disabled.collector.buffer(fullBlock);
  assert.throws(
    () => disabled.collector.buffer(shortBlock),
    /differs from the one provided/,
  );

  // Enabled: a short audio block is accepted.
  const enabled = analyzerPair(model, licenseKey());
  enabled.collector.initialize(sampleRate, blockSize, true);
  enabled.collector.buffer(fullBlock);
  enabled.collector.buffer(shortBlock); // should not throw
  console.log("  PASSED");
}

/**
 * Tests that resetting the analyzer leaves the collector initialized for continued collection.
 */
function testAnalyzerResetKeepsCollectorInitialized() {
  console.log("Running: testAnalyzerResetKeepsCollectorInitialized");

  const model = Model.fromFile(getAnalysisModelPath());
  const sampleRate = model.getOptimalSampleRate();
  const blockSize = model.getOptimalBlockSize(sampleRate);

  const { collector, analyzer } = analyzerPair(model, licenseKey());
  collector.initialize(sampleRate, blockSize, false);

  analyzer.reset();

  // Collecting another audio block works after reset because the collector stays initialized.
  collector.buffer(new Float32Array(blockSize));
  assertValidAnalysisResult(analyzer.analyzeBuffered());
  console.log("  PASSED");
}

// Run all tests
function runAllTests() {
  console.log("Running end-to-end tests...\n");

  const tests = [
    testProcessFullFile,
    testProcessBlocksWithVad,
    testVadResetClearsPublishedPrediction,
    testVadRejectsProcessingBeforeInitialize,
    testVadParameters,
    testVadRejectsEnhancementModel,
    testFileAnalyzerShortAudio,
    testFileAnalyzerWindowing,
    testAnalyzerPairDirect,
    testAnalyzerRejectsNonAnalysisModel,
    testCollectorRejectsBlockBeforeInitialize,
    testCollectorValidatesLayout,
    testAnalyzerPairRejectsLicenseWithNul,
    testCollectorVariableBlockSize,
    testAnalyzerResetKeepsCollectorInitialized,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      test();
      passed++;
    } catch (error) {
      console.log(`  FAILED: ${error.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests();
