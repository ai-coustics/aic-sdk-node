# AI-Coustics Speech Enhancement for Node.js

Node.js bindings for the [ai-coustics](https://ai-coustics.com) speech enhancement SDK. This package provides a high-level API for real-time audio processing with advanced noise reduction and speech enhancement capabilities.

## Features

- 🎯 **Easy to use** - High-level TypeScript/JavaScript API
- 🚀 **Low latency** - Multiple model variants from 10ms to 30ms
- 🔊 **High quality** - State-of-the-art ML-based speech enhancement
- 🎚️ **Configurable** - Adjustable enhancement level, voice gain, and noise gate
- 📦 **Cross-platform** - Supports macOS (x64/ARM64), Linux (x64/ARM64), and Windows (x64)
- 💪 **Type-safe** - Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @ai-coustics/aic-sdk
```

The SDK binaries will be automatically downloaded during installation for your platform.

### Supported Platforms

- macOS (x64, ARM64)
- Linux (x64, ARM64)
- Windows (x64)

## Quick Start

### Setting Your License Key

You can provide your license key in two ways:

1. **Environment Variable (Recommended for CI/CD):**
   ```bash
   export AIC_SDK_LICENSE="your-license-key"
   ```

2. **Direct in Code:**
   ```javascript
   const model = new Model(ModelType.QUAIL_S48, 'your-license-key');
   ```

### JavaScript

```javascript
const { Model, ModelType, Parameter } = require('@ai-coustics/aic-sdk');

// Create a model (reads from AIC_SDK_LICENSE env var if available)
const licenseKey = process.env.AIC_SDK_LICENSE || 'YOUR_LICENSE_KEY';
const model = new Model(ModelType.QUAIL_S48, licenseKey);

// Get optimal settings
const sampleRate = model.getOptimalSampleRate();
const numFrames = model.getOptimalNumFrames();

// Initialize
model.initialize({
  sampleRate: sampleRate,
  numChannels: 1,
  numFrames: numFrames
});

// Process audio (Float32Array, modified in-place)
const audioBuffer = new Float32Array(numFrames);
// ... fill audioBuffer with audio data ...

model.processInterleaved(audioBuffer, 1, numFrames);

// Clean up
model.destroy();
```

### TypeScript

```typescript
import { Model, ModelType, Parameter, AudioConfig } from '@ai-coustics/aic-sdk';

const licenseKey = process.env.AIC_SDK_LICENSE || 'YOUR_LICENSE_KEY';
const model = new Model(ModelType.QUAIL_S48, licenseKey);

const config: AudioConfig = {
  sampleRate: model.getOptimalSampleRate(),
  numChannels: 1,
  numFrames: model.getOptimalNumFrames()
};

model.initialize(config);

// Adjust parameters
model.setParameter(Parameter.ENHANCEMENT_LEVEL, 0.8);
model.setParameter(Parameter.VOICE_GAIN, 1.2);

const audioBuffer = new Float32Array(config.numFrames);
model.processInterleaved(audioBuffer, 1, config.numFrames);

model.destroy();
```

## API Reference

### Model Types

Choose a model based on your latency and quality requirements:

| Model | Sample Rate | Latency | Use Case |
|-------|-------------|---------|----------|
| `QUAIL_XXS` | 48 kHz | 10ms | Ultra-low latency applications |
| `QUAIL_XS` | 48 kHz | 10ms | Low latency, balanced quality |
| `QUAIL_S48` | 48 kHz | 30ms | Balanced (recommended) |
| `QUAIL_S16` | 16 kHz | 30ms | Telephony, voice calls |
| `QUAIL_S8` | 8 kHz | 30ms | Narrow-band audio |
| `QUAIL_L48` | 48 kHz | 30ms | Highest quality |
| `QUAIL_L16` | 16 kHz | 30ms | High quality, telephony |
| `QUAIL_L8` | 8 kHz | 30ms | High quality, narrow-band |

### Model Class

#### Constructor

```typescript
new Model(modelType: ModelType, licenseKey: string)
```

Creates a new model instance.

#### Methods

##### `initialize(config: AudioConfig): void`

Configures the model for a specific audio format. Must be called before processing.

```typescript
interface AudioConfig {
  sampleRate: number;    // 8000 - 192000 Hz
  numChannels: number;   // 1 (mono), 2 (stereo), etc.
  numFrames: number;     // Samples per channel per process call
}
```

##### `processInterleaved(audio: Float32Array, numChannels: number, numFrames: number): void`

Processes audio with interleaved channel data (in-place).

##### `processPlanar(audio: Float32Array[], numChannels: number, numFrames: number): void`

Processes audio with separate buffers for each channel (in-place). Maximum 16 channels.

##### `setParameter(parameter: Parameter, value: number): void`

Adjusts a model parameter.

##### `getParameter(parameter: Parameter): number`

Gets the current value of a parameter.

##### `reset(): void`

Clears all internal state. Call when the audio stream is interrupted.

##### `getOutputDelay(): number`

Returns the total output delay in samples.

##### `getOptimalSampleRate(): number`

Returns the native sample rate of the model.

##### `getOptimalNumFrames(): number`

Returns the optimal number of frames for minimum latency.

##### `destroy(): void`

Releases all resources. Call when done with the model.

##### `isInitialized: boolean`

Property indicating if the model has been initialized.

### Parameters

Configurable parameters that can be adjusted at any time:

#### `ENHANCEMENT_LEVEL`
- **Range:** 0.0 - 1.0
- **Default:** 1.0
- **Description:** Controls enhancement intensity (0.0 = bypass, 1.0 = full enhancement)

#### `VOICE_GAIN`
- **Range:** 0.1 - 4.0
- **Default:** 1.0
- **Description:** Linear amplitude multiplier (1.0 = no change, 2.0 = +6dB, 4.0 = +12dB)

#### `NOISE_GATE_ENABLE`
- **Range:** 0.0 or 1.0
- **Default:** 0.0
- **Description:** Enables/disables noise gate post-processing

### Utility Functions

#### `getSdkVersion(): string`

Returns the version of the underlying C SDK.

## Advanced Usage

### Stream Processing

```javascript
const model = new Model(ModelType.QUAIL_S48, 'YOUR_LICENSE_KEY');

model.initialize({
  sampleRate: 48000,
  numChannels: 1,
  numFrames: 480
});

// Process multiple chunks
for (const audioChunk of audioStream) {
  model.processInterleaved(audioChunk, 1, 480);
  // ... output processed audio ...
}

// Reset state if stream is interrupted
model.reset();

model.destroy();
```

### Stereo Processing

```javascript
const model = new Model(ModelType.QUAIL_S48, 'YOUR_LICENSE_KEY');

model.initialize({
  sampleRate: 48000,
  numChannels: 2,
  numFrames: 480
});

// Planar layout (separate buffers)
const leftChannel = new Float32Array(480);
const rightChannel = new Float32Array(480);
model.processPlanar([leftChannel, rightChannel], 2, 480);

// Or interleaved layout
const interleavedBuffer = new Float32Array(960); // 480 * 2 channels
model.processInterleaved(interleavedBuffer, 2, 480);

model.destroy();
```

### Dynamic Parameter Adjustment

```javascript
const model = new Model(ModelType.QUAIL_S48, 'YOUR_LICENSE_KEY');
model.initialize({ sampleRate: 48000, numChannels: 1, numFrames: 480 });

// Start with mild enhancement
model.setParameter(Parameter.ENHANCEMENT_LEVEL, 0.5);

// Process some audio...

// Increase enhancement for noisy environment
model.setParameter(Parameter.ENHANCEMENT_LEVEL, 1.0);
model.setParameter(Parameter.VOICE_GAIN, 1.5);

// Enable noise gate
model.setParameter(Parameter.NOISE_GATE_ENABLE, 1.0);

model.destroy();
```

## Building from Source

If you need to build the native addon from source:

```bash
# Clone the repository
git clone <repository-url>
cd node-wrapper

# Install dependencies
npm install

# Build TypeScript and native addon
npm run build

# Run examples
npm test
```

## Requirements

- Node.js >= 14.0.0
- Valid ai-coustics SDK license key (not API license key!)
- C++ compiler (for building from source)
  - macOS: Xcode Command Line Tools
  - Linux: GCC/G++ or Clang
  - Windows: Visual Studio Build Tools

## License

This package is proprietary software. See LICENSE file for details.

Unauthorized copying, distribution, or modification is strictly prohibited.

For inquiries: systems@ai-coustics.com

## Support

- Documentation: [ai-coustics.com/docs](https://ai-coustics.com/docs)
- Issues: [GitHub Issues](https://github.com/ai-coustics/node-speech-enhancement/issues)
- Email: systems@ai-coustics.com

## Running Examples

Check the `examples/` directory for comprehensive usage examples demonstrating various features.

### Quick Start

Make sure your license key is set:

```bash
export AIC_SDK_LICENSE="your-license-key"
```

### Run Examples

```bash
# Run basic test
npm test

# Run JavaScript example
npm run example:js

# Run TypeScript example
npm run example:ts

# Run all tests and examples
npm run test:full
```

### Direct Execution

```bash
# JavaScript (can run directly with node)
node examples/example.js

# TypeScript (requires ts-node)
npx ts-node examples/example.ts
```

**Note:** TypeScript files (`.ts`) cannot be run directly with `node`. Use `ts-node` or compile them first with `tsc`.
