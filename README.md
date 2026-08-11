# aic-sdk - Node.js Bindings for ai-coustics SDK

Node.js wrapper for the ai-coustics SDK.

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
const modelPath = Model.download("quail-vf-2.2-s-16khz", "./models");
const model = Model.fromFile(modelPath);

// Get optimal configuration
const sampleRate = model.getOptimalSampleRate();
const blockSize = model.getOptimalBlockSize(sampleRate);

// Create and initialize processor
const processor = new Processor(model, licenseKey);
processor.initialize(sampleRate, blockSize, false);

// Process mono audio (Float32Array, modified in-place)
const audioBlock = new Float32Array(blockSize);
processor.process(audioBlock);
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
const modelPath = Model.download("quail-vf-2.2-s-16khz", "./models");
const model = Model.fromFile(modelPath);
```

### Model Information

```javascript
// Get model ID
const modelId = model.getId();

// Get optimal sample rate for the model
const optimalRate = model.getOptimalSampleRate();

// Get optimal block size for a specific sample rate
const optimalBlockSize = model.getOptimalBlockSize(48000);
```

### Configuring the Processor

```javascript
// Create processor
const processor = new Processor(model, licenseKey);

// Initialize with audio settings
processor.initialize(
  sampleRate,          // Sample rate in Hz (8000 - 192000)
  blockSize,           // Samples per processing call
  variableBlockSize   // Allow variable block sizes (default: false)
);
```

### OpenTelemetry Configuration

```javascript
const { Model, OtelConfig, Processor } = require("@ai-coustics/aic-sdk");

const licenseKey = process.env.AIC_SDK_LICENSE;
const model = Model.fromFile("path/to/model.aicmodel");

// Override AIC_SDK_OTEL_ENABLE for this processor only.
// The same configuration can be passed to a Vad.
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
const processorContext = processor.getContext();

processorContext.updateBearerToken(renewedJwt);
```

The same applies to `VadContext.updateBearerToken()` for a VAD created with a JWT license.

### Processing Audio

```javascript
// Mono audio (Float32Array), enhanced in-place
const audioBlock = new Float32Array(blockSize);
processor.process(audioBlock);
```

### Ending a Session

Telemetry sessions end automatically when their processor, VAD, or analyzer is destroyed. Call
`terminateSession()` to end one at a specific lifecycle event. The instance cannot process or
analyze more audio afterwards.

```javascript
processor.terminateSession();
// vad.terminateSession();
// analyzer.terminateSession();
```

### Processor Context

```javascript
const { ProcessorParameter } = require("@ai-coustics/aic-sdk");

// Get processor context
const procCtx = processor.getContext();

// Get the delay applied to the audio in samples
const delay = procCtx.getAudioDelay();

// Reset processor state (clears internal state)
procCtx.reset();

// Set enhancement parameters
procCtx.setParameter(ProcessorParameter.EnhancementLevel, 0.8);
procCtx.setParameter(ProcessorParameter.Bypass, 0.0);

// Get parameter values
const level = procCtx.getParameter(ProcessorParameter.EnhancementLevel);
console.log(`Enhancement level: ${level}`);
```

### Voice Activity Detection (VAD)

Voice activity detection runs on its own `Vad` instance, created from a dedicated VAD model
(for example `vad-2.1-xxs-16khz`). Enhancement models are rejected.

```javascript
const { Model, Vad } = require("@ai-coustics/aic-sdk");

const vadModelPath = Model.download("vad-2.1-xxs-16khz", "./models");
const vadModel = Model.fromFile(vadModelPath);
const sampleRate = vadModel.getOptimalSampleRate();
const blockSize = vadModel.getOptimalBlockSize(sampleRate);

const vad = new Vad(vadModel, licenseKey);
vad.initialize(sampleRate, blockSize, false);

// Feed mono audio to the detector. The audio block is not modified.
const audioBlock = new Float32Array(blockSize);
vad.process(audioBlock);
```

When enhancement and VAD run together, feed the VAD the original input audio, not the processor's
enhanced output. Run both on the same block instead of chaining them:

```javascript
const audioBlock = new Float32Array(blockSize);

vad.process(audioBlock); // reads the block, does not modify it
processor.process(audioBlock); // enhances the block in place
```

Enhancement is designed to change the signal, so running the VAD on its output means detecting
speech in audio that no longer matches what the VAD model expects, and it stacks the processor's
audio delay on top of the VAD's prediction delay.

The VAD context provides thread-safe access to the prediction, the VAD parameters and its state.
You can create multiple contexts from one VAD.

```javascript
const { VadParameter } = require("@ai-coustics/aic-sdk");

// Get VAD context from the VAD
const vadContext = vad.getContext();

// Configure VAD parameters. Sensitivity is the probability threshold of the model output.
vadContext.setParameter(VadParameter.Sensitivity, 0.5);
vadContext.setParameter(VadParameter.SpeechHoldDuration, 0.05);
vadContext.setParameter(VadParameter.MinimumSpeechDuration, 0.0);

// Get parameter values
console.log(`VAD sensitivity: ${vadContext.getParameter(VadParameter.Sensitivity)}`);

// How many samples the prediction lags behind the input. This delay is not applied to the
// audio, Vad.process() leaves the buffer untouched.
console.log(`Prediction delay: ${vadContext.getPredictionDelay()} samples`);

// Check for speech (after processing audio through the VAD)
console.log(`Speech detected: ${vadContext.isSpeechDetected()}`);
console.log(`Raw probability: ${vadContext.rawVadProbability()}`);

// Clear the prediction and all internal state, e.g. when the stream is interrupted
vadContext.reset();
```

### Audio Analysis

Analysis models (for example `tyto-1.1-l-16khz`) score audio quality instead of enhancing it. Use
`FileAnalyzer` for complete audio files, or `analyzerPair` for streaming
analysis.

#### FileAnalyzer

```javascript
const { Model, FileAnalyzer } = require("@ai-coustics/aic-sdk");

const licenseKey = process.env.AIC_SDK_LICENSE;
const modelPath = Model.download("tyto-1.1-l-16khz", "./models");
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
`interferingSpeech`, `noise`, `codecDegradation` and `packetLoss`. All scores are in the range 0.0
to 1.0. For every field except `speakerLoudness`, lower values indicate less problematic audio.

#### Collector and Analyzer pair

```javascript
const { Model, analyzerPair } = require("@ai-coustics/aic-sdk");

const model = Model.fromFile("path/to/tyto-1.1-l-16khz.aicmodel");
const { collector, analyzer } = analyzerPair(model, licenseKey);

const sampleRate = model.getOptimalSampleRate();
const blockSize = model.getOptimalBlockSize(sampleRate);
collector.initialize(sampleRate, blockSize, false);

// Pass one mono audio block at a time (for example on an audio thread).
const audioBlock = new Float32Array(blockSize);
collector.buffer(audioBlock);

// Analyze the collected audio off the audio thread.
const result = analyzer.analyzeBuffered();
console.log("Risk score:", result.riskScore);

// Clear state when the stream is interrupted or when seeking.
analyzer.reset();
```

## Examples

See the example files for complete working examples:

- [`examples/enhancement.js`](examples/enhancement.js) - Basic usage example
- [`examples/vad.js`](examples/vad.js) - Voice activity detection with a dedicated VAD model
- [`examples/analysis.js`](examples/analysis.js) - Audio analysis with `FileAnalyzer` and `analyzerPair`
- [`examples/file-processing.js`](examples/file-processing.js) - Enhance a WAV file block by block

Run examples with:

```bash
export AIC_SDK_LICENSE="your_license_key_here"
node examples/enhancement.js
```

## Documentation

- **Full Documentation**: [docs.ai-coustics.com](https://docs.ai-coustics.com)
- **Node.js API Reference**: See the [index.js](index.js) for detailed JSDoc documentation
- **Available Models**: [artifacts.ai-coustics.io](https://artifacts.ai-coustics.io)

## License

This Node.js wrapper is distributed under the Apache 2.0 license. The core C SDK is distributed under the proprietary AIC-SDK license.
