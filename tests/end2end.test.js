const fs = require("fs");
const assert = require("assert");

const {
  Model,
  Processor,
  ProcessorParameter,
  FileAnalyzer,
  analyzerPair,
} = require("..");
const {
  TEST_AUDIO_PATH,
  TEST_AUDIO_ENHANCED_PATH,
  VAD_RESULTS_PATH,
  getTestModelPath,
  getAnalysisModelPath,
  licenseKey,
  loadWavAudio,
  approxEqual,
} = require("./common");

/**
 * Tests audio enhancement by processing an entire mono file containing voice in a single pass.
 * Uses a non-optimal frame size (full file length) to verify the internal frame adapter handles
 * arbitrary input sizes correctly. Uses a reduced enhancement level (0.9) to exercise non-default
 * parameter paths. Compares output against a pre-generated reference file.
 */
function testProcessFullFile() {
  console.log("Running: testProcessFullFile");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getTestModelPath());

  const processor = new Processor(model, licenseKey());
  processor.initialize(audio.sampleRate, audio.numFrames, false);

  const procCtx = processor.getProcessorContext();
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
  console.log("  PASSED");
}

/**
 * Tests block-based audio processing with voice activity detection (VAD).
 * Processes audio in optimal frame-sized blocks and collects per-block speech detection results.
 * The processor is set to bypass mode to verify that VAD continues to work even when audio
 * enhancement is disabled. Compares the VAD output sequence against a pre-generated reference
 * to ensure deterministic behavior.
 */
function testProcessBlocksWithVad() {
  console.log("Running: testProcessBlocksWithVad");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getTestModelPath());

  const optimalNumFrames = model.getOptimalNumFrames(audio.sampleRate);

  const processor = new Processor(model, licenseKey());
  processor.initialize(audio.sampleRate, optimalNumFrames, false);

  const procCtx = processor.getProcessorContext();
  procCtx.setParameter(ProcessorParameter.Bypass, 1.0);

  const vadCtx = processor.getVadContext();

  const samples = new Float32Array(audio.samples);
  const blockSize = optimalNumFrames;
  const speechDetectedResults = [];
  const rawVadProbabilities = [];

  for (let offset = 0; offset + blockSize <= samples.length; offset += blockSize) {
    const chunk = samples.subarray(offset, offset + blockSize);
    processor.process(chunk);
    speechDetectedResults.push(vadCtx.isSpeechDetected());
    rawVadProbabilities.push(vadCtx.rawVadProbability());
  }

  assert(
    rawVadProbabilities.every(
      (probability) => probability >= 0.0 && probability <= 1.0,
    ),
    "Raw VAD probabilities must be in the range 0.0 to 1.0",
  );

  const expectedJson = fs.readFileSync(VAD_RESULTS_PATH, "utf8");
  const expectedResults = JSON.parse(expectedJson);

  assert.deepStrictEqual(
    speechDetectedResults,
    expectedResults,
    "VAD results do not match expected",
  );
  console.log("  PASSED");
}

/**
 * Tests that VAD output is independent of the enhancement level.
 * Uses an enhancement level of 0.5 (instead of bypass) and verifies that the VAD results
 * match the same reference as the bypass test, confirming enhancement settings do not
 * affect voice activity detection.
 */
function testProcessBlocksWithVadAndEnhancement() {
  console.log("Running: testProcessBlocksWithVadAndEnhancement");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getTestModelPath());

  const optimalNumFrames = model.getOptimalNumFrames(audio.sampleRate);

  const processor = new Processor(model, licenseKey());
  processor.initialize(audio.sampleRate, optimalNumFrames, false);

  const procCtx = processor.getProcessorContext();
  procCtx.setParameter(ProcessorParameter.EnhancementLevel, 0.5);

  const vadCtx = processor.getVadContext();

  const samples = new Float32Array(audio.samples);
  const blockSize = optimalNumFrames;
  const speechDetectedResults = [];

  for (let offset = 0; offset + blockSize <= samples.length; offset += blockSize) {
    const chunk = samples.subarray(offset, offset + blockSize);
    processor.process(chunk);
    speechDetectedResults.push(vadCtx.isSpeechDetected());
  }

  // Compare against the same expected results as the bypass test
  // This verifies that VAD output is independent of enhancement level
  const expectedJson = fs.readFileSync(VAD_RESULTS_PATH, "utf8");
  const expectedResults = JSON.parse(expectedJson);

  assert.deepStrictEqual(
    speechDetectedResults,
    expectedResults,
    "VAD results do not match expected",
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
    "mediaSpeech",
    "noise",
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
  const numFrames = model.getOptimalNumFrames(sampleRate);
  collector.initialize(sampleRate, numFrames, false);

  // Buffer five seconds of silence in optimal-size frames, then analyze.
  const frame = new Float32Array(numFrames);
  for (let buffered = 0; buffered < sampleRate * 5; buffered += numFrames) {
    collector.buffer(frame);
  }

  const result = analyzer.analyzeBuffered();
  assertValidAnalysisResult(result);

  // Reset should succeed and leave the collector initialized for reuse.
  analyzer.reset();
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
    /not supported by this operation/,
    "Enhancement model should be rejected for analysis",
  );
  console.log("  PASSED");
}

/**
 * Tests that buffering before the collector is initialized is rejected.
 */
function testCollectorRejectsBufferingBeforeInitialize() {
  console.log("Running: testCollectorRejectsBufferingBeforeInitialize");

  const model = Model.fromFile(getAnalysisModelPath());
  const { collector } = analyzerPair(model, licenseKey());

  assert.throws(
    () => collector.buffer(new Float32Array(4)),
    /must be initialized/,
  );
  console.log("  PASSED");
}

/**
 * Tests that the collector rejects buffers whose size does not match the initialized config.
 */
function testCollectorValidatesLayout() {
  console.log("Running: testCollectorValidatesLayout");

  const model = Model.fromFile(getAnalysisModelPath());
  const sampleRate = model.getOptimalSampleRate();
  const numFrames = model.getOptimalNumFrames(sampleRate);

  const { collector } = analyzerPair(model, licenseKey());
  collector.initialize(sampleRate, numFrames, false);

  // A buffer whose length differs from the initialized frame count is rejected.
  assert.throws(
    () => collector.buffer(new Float32Array(numFrames - 1)),
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
 * Tests that variable frame sizes are accepted when enabled and rejected when disabled.
 */
function testCollectorVariableFrames() {
  console.log("Running: testCollectorVariableFrames");

  const model = Model.fromFile(getAnalysisModelPath());
  const sampleRate = model.getOptimalSampleRate();
  const numFrames = model.getOptimalNumFrames(sampleRate);
  const full = new Float32Array(numFrames);
  const short = new Float32Array(20);

  // Disabled: a short buffer after a full one is rejected.
  const disabled = analyzerPair(model, licenseKey());
  disabled.collector.initialize(sampleRate, numFrames, false);
  disabled.collector.buffer(full);
  assert.throws(
    () => disabled.collector.buffer(short),
    /differs from the one provided/,
  );

  // Enabled: a short buffer is accepted.
  const enabled = analyzerPair(model, licenseKey());
  enabled.collector.initialize(sampleRate, numFrames, true);
  enabled.collector.buffer(full);
  enabled.collector.buffer(short); // should not throw
  console.log("  PASSED");
}

/**
 * Tests that resetting the analyzer leaves the collector initialized for continued buffering.
 */
function testAnalyzerResetKeepsCollectorInitialized() {
  console.log("Running: testAnalyzerResetKeepsCollectorInitialized");

  const model = Model.fromFile(getAnalysisModelPath());
  const sampleRate = model.getOptimalSampleRate();
  const numFrames = model.getOptimalNumFrames(sampleRate);

  const { collector, analyzer } = analyzerPair(model, licenseKey());
  collector.initialize(sampleRate, numFrames, false);

  analyzer.reset();

  // Buffering still works after reset because the collector stays initialized.
  collector.buffer(new Float32Array(numFrames));
  assertValidAnalysisResult(analyzer.analyzeBuffered());
  console.log("  PASSED");
}

// Run all tests
function runAllTests() {
  console.log("Running end-to-end tests...\n");

  const tests = [
    testProcessFullFile,
    testProcessBlocksWithVad,
    testProcessBlocksWithVadAndEnhancement,
    testFileAnalyzerShortAudio,
    testFileAnalyzerWindowing,
    testAnalyzerPairDirect,
    testAnalyzerRejectsNonAnalysisModel,
    testCollectorRejectsBufferingBeforeInitialize,
    testCollectorValidatesLayout,
    testAnalyzerPairRejectsLicenseWithNul,
    testCollectorVariableFrames,
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
