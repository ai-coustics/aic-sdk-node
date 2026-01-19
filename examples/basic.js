const {
  Model,
  Processor,
  ProcessorParameter,
  VadParameter,
  getVersion,
  getCompatibleModelVersion,
} = require("..");

// Check for license key
if (!process.env.AIC_SDK_LICENSE) {
  console.error("Error: AIC_SDK_LICENSE environment variable not set");
  console.error("Get your license key from https://developers.ai-coustics.com");
  process.exit(1);
}

console.log("SDK Version:", getVersion());
console.log("Compatible Model Version:", getCompatibleModelVersion());

// Download and load a model
let model;
try {
  const modelPath = Model.download("quail-vf-l-16khz", "/tmp/aic-models");
  console.log("Model downloaded to:", modelPath);
  model = Model.fromFile(modelPath);
  console.log("Model ID:", model.getId());
} catch (error) {
  console.error("Failed to load model:", error.message);
  process.exit(1);
}

// Get optimal settings
const sampleRate = model.getOptimalSampleRate();
const numFrames = model.getOptimalNumFrames(sampleRate);

console.log("Sample Rate:", sampleRate);
console.log("Num Frames:", numFrames);

// Create processor
let processor;
try {
  processor = new Processor(model, process.env.AIC_SDK_LICENSE);
} catch (error) {
  console.error("Failed to create processor:", error.message);
  process.exit(1);
}

// Initialize for stereo audio
try {
  processor.initialize(sampleRate, 2, numFrames, false);
} catch (error) {
  console.error("Failed to initialize processor:", error.message);
  process.exit(1);
}

// Get processor context for parameter control
const processorContext = processor.getProcessorContext();
console.log("Output Delay:", processorContext.getOutputDelay(), "samples");

// Set enhancement parameters
try {
  processorContext.setParameter(ProcessorParameter.EnhancementLevel, 0.7);
  processorContext.setParameter(ProcessorParameter.VoiceGain, 1.5);
} catch (error) {
  console.error("Failed to set parameters:", error.message);
  process.exit(1);
}

console.log(
  "Enhancement Level:",
  processorContext.getParameter(ProcessorParameter.EnhancementLevel),
);
console.log(
  "Voice Gain:",
  processorContext.getParameter(ProcessorParameter.VoiceGain),
);

// Process interleaved audio
const interleavedBuffer = new Float32Array(2 * numFrames);
for (let i = 0; i < interleavedBuffer.length; i++) {
  interleavedBuffer[i] = Math.random() * 0.1;
}
try {
  processor.processInterleaved(interleavedBuffer);
  console.log("Processed interleaved audio");
} catch (error) {
  console.error("Failed to process interleaved audio:", error.message);
  process.exit(1);
}

// Reset processor state
processorContext.reset();

// Process planar audio
const planarBuffers = [
  new Float32Array(numFrames), // Left channel
  new Float32Array(numFrames), // Right channel
];
for (let i = 0; i < numFrames; i++) {
  planarBuffers[0][i] = Math.random() * 0.1;
  planarBuffers[1][i] = Math.random() * 0.1;
}
try {
  processor.processPlanar(planarBuffers);
  console.log("Processed planar audio");
} catch (error) {
  console.error("Failed to process planar audio:", error.message);
  process.exit(1);
}

// Use VAD (Voice Activity Detection)
try {
  const vad = processor.getVadContext();
  vad.setParameter(VadParameter.SpeechHoldDuration, 0.1);
  vad.setParameter(VadParameter.Sensitivity, 7.0);
  vad.setParameter(VadParameter.MinimumSpeechDuration, 0.5);

  console.log(
    "VAD Speech Hold Duration:",
    vad.getParameter(VadParameter.SpeechHoldDuration),
  );
  console.log("VAD Sensitivity:", vad.getParameter(VadParameter.Sensitivity));
  console.log(
    "VAD Minimum Speech Duration:",
    vad.getParameter(VadParameter.MinimumSpeechDuration),
  );
  console.log("Speech Detected:", vad.isSpeechDetected());
} catch (error) {
  console.error("Failed to use VAD:", error.message);
  process.exit(1);
}

console.log("\nExample completed successfully");
