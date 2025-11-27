const { Model, ModelType, EnhancementParameter, VadParameter, getVersion } = require('..');

// Check for license key
if (!process.env.AIC_SDK_LICENSE) {
  console.error('Error: AIC_SDK_LICENSE environment variable not set');
  console.error('Get your license key from https://developers.ai-coustics.io');
  process.exit(1);
}

console.log('SDK Version:', getVersion());

// Create a model
const model = new Model(ModelType.QuailS48, process.env.AIC_SDK_LICENSE);

// Get optimal settings
const sampleRate = model.optimalSampleRate();
const numFrames = model.optimalNumFrames(sampleRate);

console.log('Sample Rate:', sampleRate);
console.log('Num Frames:', numFrames);

// Initialize for stereo audio
model.initialize(sampleRate, 2, numFrames, false);
console.log('Output Delay:', model.outputDelay(), 'samples');

// Set enhancement parameters
model.setParameter(EnhancementParameter.EnhancementLevel, 0.7);
model.setParameter(EnhancementParameter.VoiceGain, 1.5);

console.log('Enhancement Level:', model.getParameter(EnhancementParameter.EnhancementLevel));
console.log('Voice Gain:', model.getParameter(EnhancementParameter.VoiceGain));

// Process interleaved audio
const interleavedBuffer = new Float32Array(2 * numFrames);
// Fill with test data
for (let i = 0; i < interleavedBuffer.length; i++) {
  interleavedBuffer[i] = Math.random() * 0.1;
}
model.processInterleaved(interleavedBuffer, 2, numFrames);
console.log('Processed interleaved audio');

// Reset model
model.reset();

// Process planar audio
const planarBuffers = [
  new Float32Array(numFrames), // Left channel
  new Float32Array(numFrames), // Right channel
];
// Fill with test data
for (let i = 0; i < numFrames; i++) {
  planarBuffers[0][i] = Math.random() * 0.1;
  planarBuffers[1][i] = Math.random() * 0.1;
}
model.processPlanar(planarBuffers);
console.log('Processed planar audio');

// Create and use VAD
const vad = model.createVad();
vad.setParameter(VadParameter.Sensitivity, 6.0);
vad.setParameter(VadParameter.LookbackBufferSize, 10.0);

console.log('VAD Sensitivity:', vad.getParameter(VadParameter.Sensitivity));
console.log('VAD Lookback Buffer Size:', vad.getParameter(VadParameter.LookbackBufferSize));
console.log('Speech Detected:', vad.isSpeechDetected());

console.log('\nExample completed successfully');
