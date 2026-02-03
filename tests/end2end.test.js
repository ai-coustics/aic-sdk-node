const fs = require("fs");
const assert = require("assert");

const { Model, Processor, ProcessorParameter } = require("..");
const {
  TEST_AUDIO_PATH,
  TEST_AUDIO_ENHANCED_PATH,
  VAD_RESULTS_PATH,
  getTestModelPath,
  licenseKey,
  loadWavAudio,
  interleavedToSequential,
  sequentialToInterleaved,
  interleavedToPlanar,
  planarToInterleaved,
  approxEqual,
} = require("./common");

/**
 * Tests audio enhancement by processing an entire stereo file containing voice in a single pass.
 * Uses a non-optimal frame size (full file length) to verify the internal frame adapter handles
 * arbitrary input sizes correctly. Uses a reduced enhancement level (0.9) and slightly lower
 * voice gain (0.9) to exercise non-default parameter paths. Compares output against a
 * pre-generated reference file.
 */
function testProcessFullFileInterleaved() {
  console.log("Running: testProcessFullFileInterleaved");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getTestModelPath());

  const processor = new Processor(model, licenseKey());
  processor.initialize(
    audio.sampleRate,
    audio.numChannels,
    audio.numFrames,
    false,
  );

  const procCtx = processor.getProcessorContext();
  procCtx.setParameter(ProcessorParameter.EnhancementLevel, 0.9);
  procCtx.setParameter(ProcessorParameter.VoiceGain, 0.9);

  const samples = new Float32Array(audio.interleavedSamples);
  processor.processInterleaved(samples);

  const expectedOutput = loadWavAudio(TEST_AUDIO_ENHANCED_PATH);

  let mismatchCount = 0;
  for (let i = 0; i < samples.length; i++) {
    if (!approxEqual(samples[i], expectedOutput.interleavedSamples[i], 1e-6)) {
      mismatchCount++;
      if (mismatchCount <= 5) {
        console.log(
          `  Sample mismatch at index ${i}: got ${samples[i]}, expected ${expectedOutput.interleavedSamples[i]}`,
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
 * Tests audio enhancement using sequential sample layout.
 * Converts the test audio to sequential format (all samples for channel 0, then channel 1, etc.),
 * processes it, and verifies the output matches the reference after converting back to interleaved.
 */
function testProcessFullFileSequential() {
  console.log("Running: testProcessFullFileSequential");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getTestModelPath());

  const processor = new Processor(model, licenseKey());
  processor.initialize(
    audio.sampleRate,
    audio.numChannels,
    audio.numFrames,
    false,
  );

  const procCtx = processor.getProcessorContext();
  procCtx.setParameter(ProcessorParameter.EnhancementLevel, 0.9);
  procCtx.setParameter(ProcessorParameter.VoiceGain, 0.9);

  const samples = interleavedToSequential(
    audio.interleavedSamples,
    audio.numChannels,
  );
  processor.processSequential(samples);

  const result = sequentialToInterleaved(samples, audio.numChannels);
  const expectedOutput = loadWavAudio(TEST_AUDIO_ENHANCED_PATH);

  let mismatchCount = 0;
  for (let i = 0; i < result.length; i++) {
    if (!approxEqual(result[i], expectedOutput.interleavedSamples[i], 1e-6)) {
      mismatchCount++;
      if (mismatchCount <= 5) {
        console.log(
          `  Sample mismatch at index ${i}: got ${result[i]}, expected ${expectedOutput.interleavedSamples[i]}`,
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
 * Tests audio enhancement using planar sample layout.
 * Converts the test audio to planar format (separate buffer per channel),
 * processes it, and verifies the output matches the reference after converting back to interleaved.
 */
function testProcessFullFilePlanar() {
  console.log("Running: testProcessFullFilePlanar");

  const audio = loadWavAudio(TEST_AUDIO_PATH);
  const model = Model.fromFile(getTestModelPath());

  const processor = new Processor(model, licenseKey());
  processor.initialize(
    audio.sampleRate,
    audio.numChannels,
    audio.numFrames,
    false,
  );

  const procCtx = processor.getProcessorContext();
  procCtx.setParameter(ProcessorParameter.EnhancementLevel, 0.9);
  procCtx.setParameter(ProcessorParameter.VoiceGain, 0.9);

  const planar = interleavedToPlanar(
    audio.interleavedSamples,
    audio.numChannels,
  );
  processor.processPlanar(planar);

  const result = planarToInterleaved(planar);
  const expectedOutput = loadWavAudio(TEST_AUDIO_ENHANCED_PATH);

  let mismatchCount = 0;
  for (let i = 0; i < result.length; i++) {
    if (!approxEqual(result[i], expectedOutput.interleavedSamples[i], 1e-6)) {
      mismatchCount++;
      if (mismatchCount <= 5) {
        console.log(
          `  Sample mismatch at index ${i}: got ${result[i]}, expected ${expectedOutput.interleavedSamples[i]}`,
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
  processor.initialize(
    audio.sampleRate,
    audio.numChannels,
    optimalNumFrames,
    false,
  );

  const procCtx = processor.getProcessorContext();
  procCtx.setParameter(ProcessorParameter.Bypass, 1.0);

  const vadCtx = processor.getVadContext();

  const samples = new Float32Array(audio.interleavedSamples);
  const blockSize = optimalNumFrames * audio.numChannels;
  const speechDetectedResults = [];

  for (let offset = 0; offset + blockSize <= samples.length; offset += blockSize) {
    const chunk = samples.subarray(offset, offset + blockSize);
    processor.processInterleaved(chunk);
    speechDetectedResults.push(vadCtx.isSpeechDetected());
  }

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
  processor.initialize(
    audio.sampleRate,
    audio.numChannels,
    optimalNumFrames,
    false,
  );

  const procCtx = processor.getProcessorContext();
  procCtx.setParameter(ProcessorParameter.EnhancementLevel, 0.5);

  const vadCtx = processor.getVadContext();

  const samples = new Float32Array(audio.interleavedSamples);
  const blockSize = optimalNumFrames * audio.numChannels;
  const speechDetectedResults = [];

  for (let offset = 0; offset + blockSize <= samples.length; offset += blockSize) {
    const chunk = samples.subarray(offset, offset + blockSize);
    processor.processInterleaved(chunk);
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

// Run all tests
function runAllTests() {
  console.log("Running end-to-end tests...\n");

  const tests = [
    testProcessFullFileInterleaved,
    testProcessFullFileSequential,
    testProcessFullFilePlanar,
    testProcessBlocksWithVad,
    testProcessBlocksWithVadAndEnhancement,
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
