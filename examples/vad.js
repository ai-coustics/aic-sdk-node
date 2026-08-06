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
  // Voice activity detection requires a dedicated VAD model. Enhancement models are rejected
  // because the model type is not supported by this operation.
  // Select a model id at https://artifacts.ai-coustics.io/
  const downloadDir = path.join(os.tmpdir(), "aic-models");
  const modelPath = Model.download("vad-2.1-xxs-16khz", downloadDir);
  const model = Model.fromFile(modelPath);
  const sampleRate = model.getOptimalSampleRate();
  const blockSize = model.getOptimalBlockSize(sampleRate);

  // Create the VAD with the license key and initialize it
  const vad = new Vad(model, licenseKey);
  vad.initialize(sampleRate, blockSize, false);

  console.log("Model ID:", model.getId());
  console.log("Sample Rate:", sampleRate);
  console.log("Block Size:", blockSize);

  // Get VAD context for thread safe interaction with the prediction and its parameters
  const vadContext = vad.getContext();

  // How far the prediction lags behind the input. This delay is not applied to the audio,
  // Vad.process() leaves the buffer untouched.
  console.log("Prediction Delay:", vadContext.getPredictionDelay(), "samples");

  // Configure the detector. Sensitivity is the probability threshold of the model output.
  vadContext.setParameter(VadParameter.SpeechHoldDuration, 0.08);
  vadContext.setParameter(VadParameter.Sensitivity, 0.5);
  vadContext.setParameter(VadParameter.MinimumSpeechDuration, 0.0);

  console.log(
    "Speech Hold Duration:",
    vadContext.getParameter(VadParameter.SpeechHoldDuration),
  );
  console.log(
    "Sensitivity:",
    vadContext.getParameter(VadParameter.Sensitivity),
  );

  // Feed mono audio to the detector. The audio block is not modified, it only updates the
  // prediction. Replace the silence below with your own audio.
  //
  // When enhancement and VAD run together, feed the VAD the original input audio rather than
  // the enhanced output of Processor.process().
  const audioBlock = new Float32Array(blockSize);
  vad.process(audioBlock);

  console.log("Speech Detected:", vadContext.isSpeechDetected());
  console.log("Raw VAD Probability:", vadContext.rawVadProbability());

  // Clear the prediction and all internal state, e.g. when the stream is interrupted
  vadContext.reset();

  // End the telemetry session on demand instead of waiting for the VAD to be destroyed.
  // The VAD can no longer process audio after this call.
  vad.terminateSession();
  console.log("Telemetry session terminated");
} catch (error) {
  console.error("Failed to run VAD:", error.message);
  process.exit(1);
}
