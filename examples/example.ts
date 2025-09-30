import {
  Model,
  ModelType,
  Parameter,
  getSdkVersion,
  AudioConfig,
} from "../src/index";

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
    const config: AudioConfig = {
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

// Example: Class-based audio processor
class AudioProcessor {
  private model: Model;
  private config: AudioConfig;

  constructor(modelType: ModelType, licenseKey: string) {
    this.model = new Model(modelType, licenseKey);

    // Use optimal settings
    this.config = {
      sampleRate: this.model.getOptimalSampleRate(),
      numChannels: 1,
      numFrames: this.model.getOptimalNumFrames(),
    };

    this.model.initialize(this.config);
  }

  public process(audioData: Float32Array): void {
    if (audioData.length !== this.config.numFrames * this.config.numChannels) {
      throw new Error(
        `Expected ${this.config.numFrames * this.config.numChannels} samples, got ${audioData.length}`,
      );
    }

    this.model.processInterleaved(
      audioData,
      this.config.numChannels,
      this.config.numFrames,
    );
  }

  public setEnhancementLevel(level: number): void {
    if (level < 0 || level > 1) {
      throw new Error("Enhancement level must be between 0 and 1");
    }
    this.model.setParameter(Parameter.ENHANCEMENT_LEVEL, level);
  }

  public setVoiceGain(gain: number): void {
    if (gain < 0.1 || gain > 4.0) {
      throw new Error("Voice gain must be between 0.1 and 4.0");
    }
    this.model.setParameter(Parameter.VOICE_GAIN, gain);
  }

  public reset(): void {
    this.model.reset();
  }

  public getLatencyMs(): number {
    const delaySamples = this.model.getOutputDelay();
    return (delaySamples / this.config.sampleRate) * 1000;
  }

  public destroy(): void {
    this.model.destroy();
  }
}

function classBasedExample(): void {
  console.log("\n=== Class-Based Processor Example ===");

  try {
    const processor = new AudioProcessor(ModelType.QUAIL_S48, LICENSE_KEY);

    console.log(
      "Processor latency:",
      processor.getLatencyMs().toFixed(1),
      "ms",
    );

    // Set parameters
    processor.setEnhancementLevel(0.9);
    processor.setVoiceGain(1.5);

    // Create test audio
    const audioData = new Float32Array(480); // Assuming 480 frames
    for (let i = 0; i < audioData.length; i++) {
      audioData[i] = Math.random() * 2 - 1;
    }

    // Process
    processor.process(audioData);

    console.log("Audio processed through class-based processor");

    processor.destroy();
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
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
  // Uncomment to run:
  // basicExample();
  // classBasedExample();

  console.log("\n✓ TypeScript examples completed");
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}
