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
  console.error("Get your license key from https://developers.ai-coustics.io");
  process.exit(1);
}

console.log("SDK Version:", getVersion());
console.log("Compatible Model Version:", getCompatibleModelVersion());

// Download and load a model
let model;
try {
  const modelPath = Model.download("quail-vf-2.1-l-16khz", "/tmp/aic-models");
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

// Initialize for mono audio
try {
  processor.initialize(sampleRate, numFrames, false);
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
} catch (error) {
  console.error("Failed to set parameters:", error.message);
  // Failing is fine here, so do not end the process
}

console.log(
  "Enhancement Level:",
  processorContext.getParameter(ProcessorParameter.EnhancementLevel),
);

// Process mono audio
const audioBuffer = new Float32Array(numFrames);
for (let i = 0; i < audioBuffer.length; i++) {
  audioBuffer[i] = Math.random() * 0.1;
}
console.log("Before:", audioBuffer.slice(0, 8));
try {
  processor.process(audioBuffer);
  console.log("After: ", audioBuffer.slice(0, 8));
  console.log("Processed mono audio");
} catch (error) {
  console.error("Failed to process audio:", error.message);
  process.exit(1);
}

// Reset processor state
processorContext.reset();

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
  console.log("Raw VAD Probability:", vad.rawVadProbability());
} catch (error) {
  console.error("Failed to use VAD:", error.message);
  process.exit(1);
}

console.log("\nExample completed successfully");
