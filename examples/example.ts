import { Model, ModelType, Parameter, getSdkVersion } from "../src/index";

// Get license key from environment variable
const LICENSE_KEY = process.env.AIC_SDK_LICENSE || "YOUR_LICENSE_KEY";

// Example: Basic usage with TypeScript type safety
function basicExample(): void {
  console.log("=== Basic TypeScript Example ===");
  console.log("SDK Version:", getSdkVersion());

  // Create model
  const model = new Model(ModelType.QUAIL_S48, LICENSE_KEY);

  try {
    // Get optimal configuration
    const optimalSampleRate = model.getOptimalSampleRate();
    const optimalNumFrames = model.getOptimalNumFrames();

    console.log("Optimal sample rate:", optimalSampleRate, "Hz");
    console.log("Optimal num frames:", optimalNumFrames);

    // Initialize with typed configuration
    const config = {
      sampleRate: optimalSampleRate,
      numChannels: 1,
      numFrames: optimalNumFrames,
    };

    model.initialize(config);

    console.log("Model initialized:", model.isInitialized);
    console.log("Output delay:", model.getOutputDelay(), "samples");

    // Create a test audio buffer
    const audioBuffer = new Float32Array(optimalNumFrames);

    // Fill with test data
    for (let i = 0; i < optimalNumFrames; i++) {
      const sine = Math.sin((2 * Math.PI * 440 * i) / optimalSampleRate);
      const noise = (Math.random() * 2 - 1) * 0.1;
      audioBuffer[i] = sine + noise;
    }

    // Process the audio
    model.processInterleaved(audioBuffer, 1, optimalNumFrames);

    console.log("Audio processed successfully");

    // Adjust parameters with type safety
    model.setParameter(Parameter.ENHANCEMENT_LEVEL, 0.8);
    model.setParameter(Parameter.VOICE_GAIN, 1.2);

    const enhancementLevel = model.getParameter(Parameter.ENHANCEMENT_LEVEL);
    const voiceGain = model.getParameter(Parameter.VOICE_GAIN);

    console.log(`Enhancement level: ${enhancementLevel}`);
    console.log(`Voice gain: ${voiceGain}`);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
  } finally {
    model.destroy();
    console.log("Model destroyed");
  }
}

// Run examples
console.log("AI-Coustics Speech Enhancement TypeScript Examples\n");

if (LICENSE_KEY === "YOUR_LICENSE_KEY") {
  console.log(
    '⚠️  No license key found. Set it with: export AIC_SDK_LICENSE="your-license-key"\n',
  );
}

try {
  basicExample();

  console.log("\n✓ TypeScript examples completed");
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
