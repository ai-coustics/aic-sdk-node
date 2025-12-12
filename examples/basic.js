const {
  Model,
  ModelType,
  EnhancementParameter,
  VadParameter,
  getVersion,
} = require("..");

// Check for license key
if (!process.env.AIC_SDK_LICENSE) {
  console.error("Error: AIC_SDK_LICENSE environment variable not set");
  console.error("Get your license key from https://developers.ai-coustics.io");
  process.exit(1);
}

console.log("SDK Version:", getVersion());

// Create a model with error handling
let model;
try {
  model = new Model(ModelType.QuailS48, process.env.AIC_SDK_LICENSE);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Get optimal settings
const sampleRate = model.optimalSampleRate();
const numFrames = model.optimalNumFrames(sampleRate);

console.log("Sample Rate:", sampleRate);
console.log("Num Frames:", numFrames);

// Initialize for stereo audio with error handling
try {
  model.initialize(sampleRate, 2, numFrames, false);
  console.log("Output Delay:", model.outputDelay(), "samples");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Set enhancement parameters
try {
  model.setParameter(EnhancementParameter.EnhancementLevel, 0.7);
  model.setParameter(EnhancementParameter.VoiceGain, 1.5);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(
  "Enhancement Level:",
  model.getParameter(EnhancementParameter.EnhancementLevel),
);
console.log("Voice Gain:", model.getParameter(EnhancementParameter.VoiceGain));

// Process interleaved audio with error handling
const interleavedBuffer = new Float32Array(2 * numFrames);
// Fill with test data
for (let i = 0; i < interleavedBuffer.length; i++) {
  interleavedBuffer[i] = Math.random() * 0.1;
}
try {
  model.processInterleaved(interleavedBuffer, 2, numFrames);
  console.log("Processed interleaved audio");
} catch (error) {
  console.error("Failed to process interleaved audio:", error.message);
  // In real-time scenarios, you might want to:
  // - Use the previous buffer
  // - Skip this frame
  // - Apply fallback processing
  process.exit(1); // Exit for demonstration purposes
}

// Reset model
model.reset();

// Process planar audio with error handling
const planarBuffers = [
  new Float32Array(numFrames), // Left channel
  new Float32Array(numFrames), // Right channel
];
// Fill with test data
for (let i = 0; i < numFrames; i++) {
  planarBuffers[0][i] = Math.random() * 0.1;
  planarBuffers[1][i] = Math.random() * 0.1;
}
try {
  model.processPlanar(planarBuffers);
  console.log("Processed planar audio");
} catch (error) {
  console.error("Failed to process planar audio:", error.message);
  // Handle gracefully - maybe output silence or previous frame
  process.exit(1); // Exit for demonstration purposes
}

// Create and use VAD with error handling
try {
  const vad = model.createVad();
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
  console.error(error.message);
  process.exit(1);
}

console.log("\nExample completed successfully");
