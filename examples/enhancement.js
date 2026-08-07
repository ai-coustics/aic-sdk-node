const {
  Model,
  Processor,
  ProcessorParameter,
  getVersion,
  getCompatibleModelVersion,
} = require("..");

// Check for license key
if (!process.env.AIC_SDK_LICENSE) {
  console.error("Error: AIC_SDK_LICENSE environment variable not set");
  console.error("Get your license key from https://developers.ai-coustics.com");
  process.exit(1);
}

console.log("SDK version:", getVersion());
console.log("Compatible model version:", getCompatibleModelVersion());

// Download and load an enhancement model. Enhancement models improve speech quality; use
// examples/vad.js for voice activity detection with a dedicated VAD model.
// Select a model at https://artifacts.ai-coustics.io/
let model;
try {
  const modelPath = Model.download("quail-vf-2.2-s-16khz", "/tmp/aic-models");
  console.log("Model downloaded to:", modelPath);
  model = Model.fromFile(modelPath);
  console.log("Model ID:", model.getId());
} catch (error) {
  console.error("Failed to load model:", error.message);
  process.exit(1);
}

// Get optimal settings
const sampleRate = model.getOptimalSampleRate();
const blockSize = model.getOptimalBlockSize(sampleRate);

console.log("Sample rate:", sampleRate);
console.log("Block size:", blockSize);

// Create processor
let processor;
try {
  processor = new Processor(model, process.env.AIC_SDK_LICENSE);
} catch (error) {
  console.error("Failed to create processor:", error.message);
  process.exit(1);
}

// Initialize for mono audio
try {
  processor.initialize(sampleRate, blockSize, false);
} catch (error) {
  console.error("Failed to initialize processor:", error.message);
  process.exit(1);
}

// Get processor context for parameter control
const processorContext = processor.getContext();

// Get the delay applied to the audio
console.log("Audio delay:", processorContext.getAudioDelay(), "samples");

// Set enhancement parameters
try {
  processorContext.setParameter(ProcessorParameter.EnhancementLevel, 0.7);
} catch (error) {
  console.error("Failed to set parameters:", error.message);
  // Failing is fine here, so do not end the process
}

console.log(
  "Enhancement level:",
  processorContext.getParameter(ProcessorParameter.EnhancementLevel),
);

// Process mono audio
const audioBlock = new Float32Array(blockSize);
for (let i = 0; i < audioBlock.length; i++) {
  audioBlock[i] = Math.random() * 0.1;
}
console.log("Before:", audioBlock.slice(0, 8));
try {
  processor.process(audioBlock);
  console.log("After: ", audioBlock.slice(0, 8));
  console.log("Processed mono audio");
} catch (error) {
  console.error("Failed to process audio:", error.message);
  process.exit(1);
}

// Reset processor state
processorContext.reset();

// End the telemetry session on demand instead of waiting for the processor to be destroyed.
// The processor can no longer process audio after this call.
processor.terminateSession();
console.log("Telemetry session terminated");

console.log("\nEnhancement example completed successfully");
