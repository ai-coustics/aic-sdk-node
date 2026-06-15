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
const modelPath = Model.download("quail-vf-2.1-l-16khz", "./models");
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
const modelPath = Model.download("quail-vf-2.1-l-16khz", "./models");
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

### OpenTelemetry Configuration

```javascript
const { Model, OtelConfig, Processor } = require("@ai-coustics/aic-sdk");

const licenseKey = process.env.AIC_SDK_LICENSE;
const model = Model.fromFile("path/to/model.aicmodel");

// Override AIC_SDK_OTEL_ENABLE for this processor only.
const otel = OtelConfig.withSessionId("session-1");
const processor = new Processor(model, licenseKey, otel);

// Other options:
// const processor = new Processor(model, licenseKey, OtelConfig.enabled());
// const processor = new Processor(model, licenseKey, OtelConfig.disabled());

// Control how often metrics are exported. Set to 0 to keep the SDK default
// of 60000 ms.
const fast = OtelConfig.enabled();
fast.exportIntervalMs = 5000;
const fastProcessor = new Processor(model, licenseKey, fast);
```

### Refreshing a JWT Bearer Token

When the processor was created with a JWT license, you can swap in a renewed
token while audio processing continues uninterrupted. If either the configured
key or the new token is not a JWT, an error is thrown and the existing token
stays in use.

```javascript
const model = Model.fromFile("path/to/model.aicmodel");
const processor = new Processor(model, jwtLicense);
const processorContext = processor.getProcessorContext();

processorContext.updateBearerToken(renewedJwt);
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

### Audio Analysis

Analysis models (for example `tyto-l-16khz`) score audio quality instead of enhancing it. Use
`FileAnalyzer` for complete mono buffers already in memory, or `analyzerPair` for streaming and
multi-channel analysis.

#### FileAnalyzer

```javascript
const { Model, FileAnalyzer } = require("@ai-coustics/aic-sdk");

const licenseKey = process.env.AIC_SDK_LICENSE;
const modelPath = Model.download("tyto-l-16khz", "./models");
const model = Model.fromFile(modelPath);

const analyzer = new FileAnalyzer(model, licenseKey);

// Mono Float32 samples. No channel mixing or resampling is performed.
const sampleRate = 16000;
const audio = new Float32Array(sampleRate * 12); // 12 seconds

// Analyze independent five-second windows. Pass a step in samples to control overlap,
// or omit it to step by the full window (no overlap).
const results = analyzer.analyze(audio, sampleRate, sampleRate * 5);

for (const result of results) {
  console.log("Risk score:", result.riskScore);
  console.log("Noise:", result.noise);
  console.log("Packet loss:", result.packetLoss);
}
```

Each result is an object with the fields `riskScore`, `speakerReverb`, `speakerLoudness`,
`interferingSpeech`, `mediaSpeech`, `noise` and `packetLoss`. All scores are in the range 0.0 to
1.0. For every field except `speakerLoudness`, lower values indicate less problematic audio.

#### Collector and Analyzer pair

```javascript
const { Model, analyzerPair } = require("@ai-coustics/aic-sdk");

const model = Model.fromFile("path/to/tyto-l-16khz.aicmodel");
const { collector, analyzer } = analyzerPair(model, licenseKey);

const sampleRate = model.getOptimalSampleRate();
const numFrames = model.getOptimalNumFrames(sampleRate);
collector.initialize(sampleRate, 1, numFrames, false);

// Buffer audio chunks (for example on an audio thread).
const chunk = new Float32Array(numFrames);
collector.bufferInterleaved(chunk);

// Analyze the buffered audio off the audio thread.
const result = analyzer.analyzeBuffered();
console.log("Risk score:", result.riskScore);

// Clear state when the stream is interrupted or when seeking.
analyzer.reset();
```

## Examples

See the [`basic.js`](examples/basic.js) file for a complete working example.

## Documentation

- **Full Documentation**: [docs.ai-coustics.com](https://docs.ai-coustics.com)
- **Node.js API Reference**: See the [index.js](index.js) for detailed JSDoc documentation
- **Available Models**: [artifacts.ai-coustics.io](https://artifacts.ai-coustics.io)

## License

This Node.js wrapper is distributed under the Apache 2.0 license. The core C SDK is distributed under the proprietary AIC-SDK license.
