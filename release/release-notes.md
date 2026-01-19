# Release Notes

This release comes with a number of new features and several breaking changes. Most notably, the library no longer includes any models, which significantly reduces the package size. The models are now available separately for download at https://artifacts.ai-coustics.io.

### Important Changes

- **New license keys required**: License keys previously generated in the [developer portal](https://developers.ai-coustics.com) will no longer work. New license keys must be generated.
- **Model naming changes**:
  - Quail-STT models are now called "Quail" – These models are optimized for human-to-machine enhancement (e.g., Speech-to-Text applications).
  - Quail models are now called "Sparrow" – These models are optimized for human-to-human enhancement (e.g., voice calls, conferencing).
  - This naming change clarifies the distinction between STT-focused models and human-to-human communication models.
- **API restructuring**: The API has been restructured to separate model data from processing instances. What was previously the `Model` class (which handled both model data and processing) has been split into:
  - `Model`: Now represents only the ML model data loaded from files.
  - `Processor`: New class that performs the actual audio processing using a model.
  - Multiple processors can share the same model, allowing efficient resource usage across streams.
  - To change parameters, reset the processor and get the output delay, use `ProcessorContext` obtained via `Processor.getProcessorContext()`. This context can be freely used across your application.

### New Features

- Models now load from files via `Model.fromFile(path)`.
- Added `Model.download(modelId, downloadDir)` to fetch models from the ai-coustics CDN.
- Added `Model.getId()` to query the id of a model.
- A single `Model` instance can be shared across multiple `Processor` instances.
- Added `Processor` class so each stream can be initialized independently from a shared model while sharing weights.
- Added `getCompatibleModelVersion()` to query the required model version for this SDK.
- Added context-based APIs for control operations:
  - `Processor.getProcessorContext()` returns a `ProcessorContext` for parameter management
  - `Processor.getVadContext()` returns a `VadContext` for voice activity detection
- Model query methods:
  - `Model.getOptimalSampleRate()` – gets optimal sample rate for a model
  - `Model.getOptimalNumFrames(sampleRate)` – gets optimal frame count for a model at given sample rate
- Added `Processor.processSequential()` for sequential/channel-contiguous audio layout
- Comprehensive JSDoc documentation for all classes, methods, and parameters

### Breaking Changes

- Removed `ModelType` enum; callers must supply a model file path to `Model.fromFile()` or download via `Model.download()` instead of selecting a built-in model.
- The `Model` class no longer handles processing directly. Use `new Processor(model, licenseKey)` instead.
- License keys are now provided to `Processor` constructor rather than `Model`.
- Renamed `EnhancementParameter` to `ProcessorParameter`:
  - `EnhancementParameter.Bypass` → `ProcessorParameter.Bypass`
  - `EnhancementParameter.EnhancementLevel` → `ProcessorParameter.EnhancementLevel`
  - `EnhancementParameter.VoiceGain` → `ProcessorParameter.VoiceGain`
- VAD is now accessed via `VadContext` obtained from `Processor.getVadContext()` instead of `Model.createVad()`:
  - `Vad.isSpeechDetected()` → `VadContext.isSpeechDetected()`
  - `Vad.setParameter()` → `VadContext.setParameter()`
  - `Vad.getParameter()` → `VadContext.getParameter()`
- Processor control via `ProcessorContext` obtained from `Processor.getProcessorContext()`:
  - `Model.reset()` → `ProcessorContext.reset()`
  - `Model.setParameter()` → `ProcessorContext.setParameter()`
  - `Model.getParameter()` → `ProcessorContext.getParameter()`
  - `Model.outputDelay()` → `ProcessorContext.getOutputDelay()`
- Model query methods renamed:
  - `Model.optimalSampleRate()` → `Model.getOptimalSampleRate()`
  - `Model.optimalNumFrames()` → `Model.getOptimalNumFrames()`

### Migration

```javascript
// Old (v0.x)
const { Model, ModelType, EnhancementParameter, VadParameter } = require("@ai-coustics/aic-sdk");

const model = new Model(ModelType.QuailL48, licenseKey);
model.initialize(48000, 1, 480, false);
model.setParameter(EnhancementParameter.EnhancementLevel, 0.8);
model.processInterleaved(audio);

const vad = model.createVad();
vad.setParameter(VadParameter.Sensitivity, 5.0);
if (vad.isSpeechDetected()) {
  console.log("Speech!");
}

// New (v1.0)
const { Model, Processor, ProcessorParameter, VadParameter } = require("@ai-coustics/aic-sdk");

const modelPath = Model.download("sparrow-l-48khz", "/tmp/models");
const model = Model.fromFile(modelPath);
// Or load directly: const model = Model.fromFile("/path/to/sparrow-l-48khz.aicmodel");

const processor = new Processor(model, licenseKey);
processor.initialize(48000, 1, 480, false);

const ctx = processor.getProcessorContext();
ctx.setParameter(ProcessorParameter.EnhancementLevel, 0.8);
processor.processInterleaved(audio);

const vad = processor.getVadContext();
vad.setParameter(VadParameter.Sensitivity, 5.0);
if (vad.isSpeechDetected()) {
  console.log("Speech!");
}
```
