# ai-coustics Speech Enhancement SDK for Node.js

Node.js bindings for the ai-coustics Speech Enhancement SDK.

## Prerequisites

- SDK license key from [ai-coustics Developer Portal](https://developers.ai-coustics.io)

## Installation

```bash
npm install @ai-coustics/aic-sdk
```

### Supported Platforms

- Linux: x64, ARM64 (GNU libc)
- macOS: x64, ARM64
- Windows: x64, ARM64 (MSVC)

## Example

```javascript
const { Model, ModelType, EnhancementParameter } = require('@ai-coustics/aic-sdk');

const model = new Model(ModelType.QuailS48, process.env.AIC_SDK_LICENSE);

// Get optimal settings
const sampleRate = model.optimalSampleRate();
const numFrames = model.optimalNumFrames(sampleRate);

// Initialize for stereo audio
model.initialize(sampleRate, 2, numFrames, false);

// Set enhancement parameters
model.setParameter(EnhancementParameter.EnhancementLevel, 0.7);
model.setParameter(EnhancementParameter.VoiceGain, 1.5);

// Process interleaved audio
const interleavedBuffer = new Float32Array(2 * numFrames);
model.processInterleaved(interleavedBuffer, 2, numFrames);

// Or process planar audio
const planarBuffers = [
  new Float32Array(numFrames), // Left channel
  new Float32Array(numFrames), // Right channel
];
model.processPlanar(planarBuffers);
```

## Links

- [Example Usage](examples/basic.js)
- [API Reference](index.js)
- [C SDK Reference](https://github.com/ai-coustics/aic-sdk-c/blob/HEAD/sdk-reference.md)
- [Documentation](https://docs.ai-coustics.com/)
- [Issues](https://github.com/ai-coustics/aic-sdk-node/issues)

### Other SDKs

| Platform | Repository |
|----------|------------|
| **C** | [aic-sdk-c](https://github.com/ai-coustics/aic-sdk-c) |
| **C++** | [aic-sdk-cpp](https://github.com/ai-coustics/aic-sdk-cpp) |
| **Python** | [aic-sdk-py](https://github.com/ai-coustics/aic-sdk-py) |
| **Rust** | [aic-sdk-rs](https://github.com/ai-coustics/aic-sdk-rs) |
| **Web (WASM)** | [aic-sdk-wasm](https://github.com/ai-coustics/aic-sdk-wasm) |
| **Demo Plugin** | [aic-sdk-plugin](https://github.com/ai-coustics/aic-sdk-plugin) |

## License

Dual-licensed:
- Node.js wrapper code: Apache License 2.0
- AIC SDK binaries: Proprietary AIC-SDK Binary License Agreement
