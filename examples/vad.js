const {
  Model,
  Vad,
  VadParameter,
  getVersion,
  getCompatibleModelVersion,
} = require("..");
const os = require("os");
const path = require("path");

const licenseKey = process.env.AIC_SDK_LICENSE;
if (!licenseKey) {
  console.error("Error: AIC_SDK_LICENSE environment variable not set");
  console.error("Get your license key from https://developers.ai-coustics.io");
  process.exit(1);
}

console.log("SDK Version:", getVersion());
console.log("Compatible Model Version:", getCompatibleModelVersion());

try {
  // Voice activity detection requires a dedicated VAD model. Enhancement models are rejected.
  const downloadDir = path.join(os.tmpdir(), "aic-models");
  const modelPath = Model.download("vad-2.1-xxs-16khz", downloadDir);
  const model = Model.fromFile(modelPath);
  const sampleRate = model.getOptimalSampleRate();
  const blockSize = model.getOptimalBlockSize(sampleRate);

  const vad = new Vad(model, licenseKey);
  vad.initialize(sampleRate, blockSize, false);

  const vadContext = vad.getContext();
  vadContext.setParameter(VadParameter.SpeechHoldDuration, 0.08);
  vadContext.setParameter(VadParameter.Sensitivity, 0.5);
  vadContext.setParameter(VadParameter.MinimumSpeechDuration, 0.0);

  console.log("Model ID:", model.getId());
  console.log("Sample Rate:", sampleRate);
  console.log("Block Size:", blockSize);
  console.log("Prediction Delay:", vadContext.getOutputDelay(), "samples");

  // Replace this silence with mono audio from your application. Processing updates the
  // prediction but does not modify the audio block.
  const audioBlock = new Float32Array(blockSize);
  vad.process(audioBlock);

  console.log("Speech Detected:", vadContext.isSpeechDetected());
  console.log("Raw VAD Probability:", vadContext.rawVadProbability());

  // Clear the prediction and internal state when the stream is interrupted.
  vadContext.reset();
} catch (error) {
  console.error("Failed to run VAD:", error.message);
  process.exit(1);
}
