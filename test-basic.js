#!/usr/bin/env node

const { Model, ModelType, Parameter, getSdkVersion } = require("./dist/index");

console.log("=== AI-Coustics SDK Test ===\n");

// Get license key from environment variable
const licenseKey = process.env.AIC_SDK_LICENSE || "YOUR_LICENSE_KEY";

if (licenseKey === "YOUR_LICENSE_KEY") {
  console.log(
    "⚠️  No license key found in environment variable AIC_SDK_LICENSE",
  );
  console.log('   Set it with: export AIC_SDK_LICENSE="your-license-key"\n');
}

// Test 1: Get SDK version
console.log("1. Testing getSdkVersion()...");
try {
  const version = getSdkVersion();
  console.log("   ✓ SDK Version:", version);
} catch (error) {
  console.error("   ✗ Error:", error.message);
  process.exit(1);
}

// Test 2: Create model
console.log("\n2. Testing Model creation...");

try {
  const model = new Model(ModelType.QUAIL_S48, licenseKey);
  console.log("   ✓ Model created successfully");

  // Test 3: Get optimal settings
  console.log(
    "\n3. Testing getOptimalSampleRate() and getOptimalNumFrames()...",
  );
  const sampleRate = model.getOptimalSampleRate();
  const numFrames = model.getOptimalNumFrames(sampleRate);
  console.log("   ✓ Optimal sample rate:", sampleRate, "Hz");
  console.log("   ✓ Optimal num frames:", numFrames);

  // Test 4: Initialize model
  console.log("\n4. Testing model.initialize()...");
  model.initialize({
    sampleRate: sampleRate,
    numChannels: 1,
    numFrames: numFrames,
    variableFrames: false,
  });
  console.log("   ✓ Model initialized");
  console.log("   ✓ Is initialized:", model.isInitialized);

  // Test 5: Get output delay
  console.log("\n5. Testing getOutputDelay()...");
  const delay = model.getOutputDelay();
  const delayMs = ((delay / sampleRate) * 1000).toFixed(1);
  console.log("   ✓ Output delay:", delay, "samples (" + delayMs + " ms)");

  // Test 6: Set and get parameters
  console.log("\n6. Testing parameter get/set...");
  model.setParameter(Parameter.ENHANCEMENT_LEVEL, 0.75);
  model.setParameter(Parameter.VOICE_GAIN, 1.5);
  const enhLevel = model.getParameter(Parameter.ENHANCEMENT_LEVEL);
  const voiceGain = model.getParameter(Parameter.VOICE_GAIN);
  console.log("   ✓ Enhancement level:", enhLevel);
  console.log("   ✓ Voice gain:", voiceGain);

  // Test 7: Process audio (interleaved)
  console.log("\n7. Testing audio processing (interleaved)...");
  const audioBuffer = new Float32Array(numFrames);

  // Fill with test signal (sine wave + noise)
  for (let i = 0; i < numFrames; i++) {
    const sine = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    const noise = (Math.random() * 2 - 1) * 0.2;
    audioBuffer[i] = sine + noise;
  }

  model.processInterleaved(audioBuffer, 1, numFrames);
  console.log("   ✓ Audio processed successfully");
  console.log("   ✓ Buffer length:", audioBuffer.length);

  // Test 8: Reset model
  console.log("\n8. Testing model.reset()...");
  model.reset();
  console.log("   ✓ Model reset successfully");

  // Test 9: Process audio (planar)
  console.log("\n9. Testing audio processing (planar - stereo)...");
  model.initialize({
    sampleRate: sampleRate,
    numChannels: 2,
    numFrames: numFrames,
    variableFrames: false,
  });

  const leftChannel = new Float32Array(numFrames);
  const rightChannel = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    leftChannel[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
    rightChannel[i] = Math.sin((2 * Math.PI * 880 * i) / sampleRate);
  }

  model.processPlanar([leftChannel, rightChannel], 2, numFrames);
  console.log("   ✓ Stereo audio processed successfully");

  // Test 10: Cleanup
  console.log("\n10. Testing model.destroy()...");
  model.destroy();
  console.log("   ✓ Model destroyed");

  console.log("\n=== All tests passed! ✓ ===\n");
} catch (error) {
  console.error("   ✗ Error:", error.message);
  console.error("\n=== Test failed ===");
  console.error(
    '\nIf you see "License key format is invalid", set your license key:',
  );
  console.error('  export AIC_SDK_LICENSE="your-actual-license-key"');
  console.error("  node test-basic.js\n");
  process.exit(1);
}
