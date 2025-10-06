const { Model, ModelType, Parameter, getSdkVersion } = require("../dist/index");

// Get license key from environment variable
const LICENSE_KEY = process.env.AIC_SDK_LICENSE || "YOUR_LICENSE_KEY";

// Example: Basic usage with interleaved audio
function basicExample() {
  console.log("=== Basic Example ===");
  console.log("SDK Version:", getSdkVersion());

  // Create model
  const model = new Model(ModelType.QUAIL_S48, LICENSE_KEY);

  try {
    // Get optimal configuration
    const optimalSampleRate = model.getOptimalSampleRate();
    const optimalNumFrames = model.getOptimalNumFrames();

    console.log("Optimal sample rate:", optimalSampleRate, "Hz");
    console.log("Optimal num frames:", optimalNumFrames);

    // Initialize with optimal settings (mono)
    model.initialize({
      sampleRate: optimalSampleRate,
      numChannels: 1,
      numFrames: optimalNumFrames,
    });

    console.log("Model initialized successfully");
    console.log("Output delay:", model.getOutputDelay(), "samples");

    // Create a test audio buffer (interleaved)
    const audioBuffer = new Float32Array(optimalNumFrames);

    // Fill with some test data (sine wave + noise)
    for (let i = 0; i < optimalNumFrames; i++) {
      const sine = Math.sin((2 * Math.PI * 440 * i) / optimalSampleRate);
      const noise = (Math.random() * 2 - 1) * 0.1;
      audioBuffer[i] = sine + noise;
    }

    console.log("Processing audio...");

    // Process the audio (in-place modification)
    model.processInterleaved(audioBuffer, 1, optimalNumFrames);

    console.log("Audio processed successfully");

    // Adjust parameters
    console.log("\nAdjusting parameters...");
    model.setParameter(Parameter.ENHANCEMENT_LEVEL, 0.8);
    model.setParameter(Parameter.VOICE_GAIN, 1.2);

    console.log(
      "Enhancement level:",
      model.getParameter(Parameter.ENHANCEMENT_LEVEL),
    );
    console.log("Voice gain:", model.getParameter(Parameter.VOICE_GAIN));

    // Process again with new parameters
    model.processInterleaved(audioBuffer, 1, optimalNumFrames);
    console.log("Audio processed with new parameters");
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    // Clean up
    model.destroy();
    console.log("Model destroyed");
  }
}

// Example: Stereo audio with planar layout
function stereoExample() {
  console.log("\n=== Stereo Planar Example ===");

  const model = new Model(ModelType.QUAIL_S48, LICENSE_KEY);

  try {
    const optimalSampleRate = model.getOptimalSampleRate();
    const optimalNumFrames = model.getOptimalNumFrames();

    // Initialize for stereo
    model.initialize({
      sampleRate: optimalSampleRate,
      numChannels: 2,
      numFrames: optimalNumFrames,
    });

    console.log("Initialized for stereo at", optimalSampleRate, "Hz");

    // Create separate buffers for left and right channels
    const leftChannel = new Float32Array(optimalNumFrames);
    const rightChannel = new Float32Array(optimalNumFrames);

    // Fill with test data
    for (let i = 0; i < optimalNumFrames; i++) {
      leftChannel[i] = Math.sin((2 * Math.PI * 440 * i) / optimalSampleRate);
      rightChannel[i] = Math.sin((2 * Math.PI * 880 * i) / optimalSampleRate);
    }

    // Process planar audio
    model.processPlanar([leftChannel, rightChannel], 2, optimalNumFrames);

    console.log("Stereo audio processed successfully");
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    model.destroy();
  }
}

// Run examples
console.log("AI-Coustics Speech Enhancement Node.js Examples\n");
if (LICENSE_KEY === "YOUR_LICENSE_KEY") {
  console.log(
    '⚠️  No license key found. Set it with: export AIC_SDK_LICENSE="your-license-key"\n',
  );
}

try {
  basicExample();
  stereoExample();

  console.log(
    "\n✓ Examples completed (uncomment examples in the code to run them)",
  );
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
