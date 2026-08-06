# Examples

## Usage

Build locally:

```bash
npm install
npm run build
```

Run the enhancement example:

```bash
export AIC_SDK_LICENSE="your-license-key"
node examples/enhancement.js
```

Run the voice activity detection example:

```bash
export AIC_SDK_LICENSE="your-license-key"
node examples/vad.js
```

Run the file processing example:

```bash
export AIC_SDK_LICENSE="your-license-key"
node examples/file-processing.js --input ./tests/data/test_signal.wav --output ./test_signal_enhanced.wav
```

Run the audio analysis example:

```bash
export AIC_SDK_LICENSE="your-license-key"
node examples/analysis.js
```

Get your license key from [ai-coustics Developer Portal](https://developers.ai-coustics.io).
