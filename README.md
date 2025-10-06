# ai-coustics Speech Enhancement SDK for Node.js

Welcome to the ai-coustics SDK! This repository provides the native JavaScript/TypeScript bindings to run our powerful real-time speech enhancement in your Node.js applications.

## What is this SDK?

Our Speech Enhancement SDK delivers state-of-the-art speech-enhancement in real-time, enabling you to build applications that remove noise and reverb from speech signals.

## Quick Start

### Acquire an SDK License Key

You need an **SDK license key**. This is distinct from the API license key used for our cloud API services. To obtain an SDK license key, please contact us at [info@ai-coustics.com](mailto:info@ai-coustics.com)

### Installation

```bash
npm install @ai-coustics/aic-sdk
```

The SDK binaries will be automatically downloaded during installation for your platform.

### Supported Platforms

- macOS (x64, ARM64)
- Linux (x64, ARM64)
- Windows (x64)

### Example Code

```javascript
import { Model, ModelType, Parameter } from '@ai-coustics/aic-sdk';

const model = new Model(ModelType.QUAIL_L48, "YOUR_LICENSE_KEY");

const config = {
  sampleRate: model.getOptimalSampleRate(),
  numChannels: 2,
  numFrames: model.getOptimalNumFrames()
};

model.initialize(config);

// Adjust parameters
model.setParameter(Parameter.ENHANCEMENT_LEVEL, 0.9);
model.setParameter(Parameter.VOICE_GAIN, 1.2);

// Planar layout (separate buffers)
const leftChannel = new Float32Array(480);
const rightChannel = new Float32Array(480);
model.processPlanar([leftChannel, rightChannel], 2, 480);

// Or interleaved layout
const interleavedBuffer = new Float32Array(2 * 480);
model.processInterleaved(interleavedBuffer, 2, 480);

model.destroy();
```

## Support & Resources

## Documentation

- [JavaScript Example](examples/example.js)
- [TypeScript Example](examples/example.ts)
- [Function Reference](src/index.ts)
- [C-SDK-Reference](https://github.com/ai-coustics/aic-sdk-c/blob/HEAD/sdk-reference.md)

### Looking for Other Languages?

The ai-coustics Speech Enhancement SDK is available in multiple programming languages to fit your development needs:

| Platform | Repository | Description |
|----------|------------|-------------|
| **C** | [aic-sdk-c](https://github.com/ai-coustics/aic-sdk-c) | Core C interface and foundation library |
| **C++** | [`aic-sdk-cpp`](https://github.com/ai-coustics/aic-sdk-cpp) | Modern C++ interface with RAII and type safety |
| **Python** | [`aic-sdk-py`](https://github.com/ai-coustics/aic-sdk-py) | Idiomatic Python interface |
| **Rust** | [`aic-sdk-rs`](https://github.com/ai-coustics/aic-sdk-rs) | Safe Rust bindings with zero-cost abstractions |
| **Web (WASM)** | [`aic-sdk-wasm`](https://github.com/ai-coustics/aic-sdk-wasm) | WebAssembly build for browser applications |


## Demo Plugin

Experience our speech enhancement models firsthand with our Demo Plugin - a complete audio plugin that showcases all available models while serving as a comprehensive C++ integration example.

| Platform | Repository | Description |
|----------|------------|-------------|
| **Demo Plugin** | [`aic-sdk-plugin`](https://github.com/ai-coustics/aic-sdk-plugin) | Audio plugin with real-time model comparison and C++ integration reference |

### Get Help

- Documentation: [docs.ai-coustics.com](https://docs.ai-coustics.com/)
- Issues: [GitHub Issues](https://github.com/ai-coustics/aic-sdk-node/issues)
- Email: [info@ai-coustics.com](mailto:info@ai-coustics.com)

## License

This project uses a dual-license structure:

- **Node.js Wrapper Code** (source files in this repository): Licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
- **AIC SDK Binaries** (files in `sdk/lib/*` and `aic.h`): Licensed under the proprietary AIC-SDK Binary License Agreement. See [LICENSE.AIC-SDK](LICENSE.AIC-SDK) for details.

When you use this package, both licenses apply to their respective components.

---

Made with ❤️ by the ai-coustics team
