# aic-sdk - Node.js Bindings for ai-coustics SDK

Node.js wrapper for the ai-coustics Speech Enhancement SDK.

For comprehensive documentation, visit [docs.ai-coustics.com](https://docs.ai-coustics.com).

> [!NOTE]
> This SDK requires a license key. Generate your key at [developers.ai-coustics.com](https://developers.ai-coustics.com).

## Installation

```bash
npm install @ai-coustics/aic-sdk
```

## Quick Start

```javascript
const { Model, Processor } = require("@ai-coustics/aic-sdk");

// Get your license key from the environment variable
const licenseKey = process.env.AIC_SDK_LICENSE;

// Download and load a model (or download manually at https://artifacts.ai-coustics.io/)
const modelPath = Model.download("sparrow-xxs-48khz", "./models");
const model = Model.fromFile(modelPath);

// Get optimal configuration
const sampleRate = model.getOptimalSampleRate();
const numFrames = model.getOptimalNumFrames(sampleRate);
const numChannels = 2;

// Create and initialize processor
const processor = new Processor(model, licenseKey);
processor.initialize(sampleRate, numChannels, numFrames, false);

// Process audio (Float32Array, interleaved: [L0, R0, L1, R1, ...])
const audioBuffer = new Float32Array(numChannels * numFrames);
processor.processInterleaved(audioBuffer);
```

## Usage

### SDK Information

```javascript
const { getVersion, getCompatibleModelVersion } = require("@ai-coustics/aic-sdk");

// Get SDK version
console.log(`SDK version: ${getVersion()}`);

// Get compatible model version
console.log(`Compatible model version: ${getCompatibleModelVersion()}`);
```

### Loading Models

Download models and find available IDs at [artifacts.ai-coustics.io](https://artifacts.ai-coustics.io/).

#### From File
```javascript
const model = Model.fromFile("path/to/model.aicmodel");
```

#### Download from CDN
```javascript
const modelPath = Model.download("sparrow-xxs-48khz", "./models");
const model = Model.fromFile(modelPath);
```

### Model Information

```javascript
// Get model ID
const modelId = model.getId();

// Get optimal sample rate for the model
const optimalRate = model.getOptimalSampleRate();

// Get optimal frame count for a specific sample rate
const optimalFrames = model.getOptimalNumFrames(48000);
```

### Configuring the Processor

```javascript
// Create processor
const processor = new Processor(model, licenseKey);

// Initialize with audio settings
processor.initialize(
  sampleRate,           // Sample rate in Hz (8000 - 192000)
  numChannels,          // Number of audio channels
  numFrames,            // Samples per channel per processing call
  allowVariableFrames   // Allow variable frame sizes (default: false)
);
```

### Processing Audio

```javascript
// Interleaved audio: [L0, R0, L1, R1, ...]
const buffer = new Float32Array(numChannels * numFrames);
processor.processInterleaved(buffer);

// Sequential audio: [L0, L1, ..., R0, R1, ...]
processor.processSequential(buffer);

// Planar audio: separate buffer per channel
const left = new Float32Array(numFrames);
const right = new Float32Array(numFrames);
processor.processPlanar([left, right]);
```

### Processor Context

```javascript
const { ProcessorParameter } = require("@ai-coustics/aic-sdk");

// Get processor context
const procCtx = processor.getProcessorContext();

// Get output delay in samples
const delay = procCtx.getOutputDelay();

// Reset processor state (clears internal buffers)
procCtx.reset();

// Set enhancement parameters
procCtx.setParameter(ProcessorParameter.EnhancementLevel, 0.8);
procCtx.setParameter(ProcessorParameter.VoiceGain, 1.5);
procCtx.setParameter(ProcessorParameter.Bypass, 0.0);

// Get parameter values
const level = procCtx.getParameter(ProcessorParameter.EnhancementLevel);
console.log(`Enhancement level: ${level}`);
```

### Voice Activity Detection (VAD)

```javascript
const { VadParameter } = require("@ai-coustics/aic-sdk");

// Get VAD context from processor
const vadCtx = processor.getVadContext();

// Configure VAD parameters
vadCtx.setParameter(VadParameter.Sensitivity, 6.0);
vadCtx.setParameter(VadParameter.SpeechHoldDuration, 0.05);
vadCtx.setParameter(VadParameter.MinimumSpeechDuration, 0.0);

// Get parameter values
const sensitivity = vadCtx.getParameter(VadParameter.Sensitivity);
console.log(`VAD sensitivity: ${sensitivity}`);

// Check for speech (after processing audio through the processor)
if (vadCtx.isSpeechDetected()) {
  console.log("Speech detected!");
}
```

## Examples

See the [`basic.js`](examples/basic.js) file for a complete working example.

## Documentation

- **Full Documentation**: [docs.ai-coustics.com](https://docs.ai-coustics.com)
- **Node.js API Reference**: See the [index.js](index.js) for detailed JSDoc documentation
- **Available Models**: [artifacts.ai-coustics.io](https://artifacts.ai-coustics.io)

## License

This Node.js wrapper is distributed under the Apache 2.0 license. The core C SDK is distributed under the proprietary AIC-SDK license.
