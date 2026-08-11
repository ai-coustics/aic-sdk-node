const { Model, FileAnalyzer, analyzerPair, getVersion } = require("..");

// Check for license key
if (!process.env.AIC_SDK_LICENSE) {
  console.error("Error: AIC_SDK_LICENSE environment variable not set");
  console.error("Get your license key from https://developers.ai-coustics.com");
  process.exit(1);
}

const licenseKey = process.env.AIC_SDK_LICENSE;

console.log("SDK version:", getVersion());

// Download and load an analysis model. Analysis models score audio quality
// instead of enhancing it.
let model;
try {
  const modelPath = Model.download("tyto-1.1-l-16khz", "/tmp/aic-models");
  console.log("Model downloaded to:", modelPath);
  model = Model.fromFile(modelPath);
  console.log("Model ID:", model.getId());
} catch (error) {
  console.error("Failed to load model:", error.message);
  process.exit(1);
}

const sampleRate = 16000;

function printResult(label, result) {
  console.log(`\n${label}:`);
  console.log("  Risk score:        ", result.riskScore.toFixed(4));
  console.log("  Speaker reverb:    ", result.speakerReverb.toFixed(4));
  console.log("  Speaker loudness:  ", result.speakerLoudness.toFixed(4));
  console.log("  Interfering speech:", result.interferingSpeech.toFixed(4));
  console.log("  Noise:             ", result.noise.toFixed(4));
  console.log("  Codec degradation: ", result.codecDegradation.toFixed(4));
  console.log("  Packet loss:       ", result.packetLoss.toFixed(4));
}

// --- FileAnalyzer: analyze a complete mono signal ---------------------------

// Twelve seconds of low-level test audio.
const audio = new Float32Array(sampleRate * 12);
for (let i = 0; i < audio.length; i++) {
  audio[i] = Math.sin(i * 0.05) * 0.1;
}

try {
  const fileAnalyzer = new FileAnalyzer(model, licenseKey);

  // Step by the full five-second window (no overlap). Pass a smaller step to overlap windows.
  const results = fileAnalyzer.analyze(audio, sampleRate, sampleRate * 5);
  console.log(`\nFileAnalyzer produced ${results.length} window(s)`);
  results.forEach((result, index) => printResult(`Window ${index}`, result));
} catch (error) {
  console.error("Failed to analyze file:", error.message);
  process.exit(1);
}

// --- Collector/Analyzer pair: streaming analysis ----------------------------

try {
  const { collector, analyzer } = analyzerPair(model, licenseKey);

  const blockSize = model.getOptimalBlockSize(sampleRate);
  collector.initialize(sampleRate, blockSize, false);

  // Pass five seconds of audio to the collector in optimal-size blocks.
  for (let offset = 0; offset + blockSize <= sampleRate * 5; offset += blockSize) {
    collector.buffer(audio.subarray(offset, offset + blockSize));
  }

  const result = analyzer.analyzeBuffered();
  printResult("Collector/Analyzer pair", result);

  // Clear state when the stream is interrupted or when seeking.
  analyzer.reset();
} catch (error) {
  console.error("Failed to analyze stream:", error.message);
  process.exit(1);
}

console.log("\nAnalysis example completed successfully");
