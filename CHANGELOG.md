# Changelog

## Unreleased

Rewritten on [napi-rs](https://napi.rs), on top of the public `aic-sdk` Rust crate.

The previous release was a raw native addon exporting low-level primitives, wrapped in a
hand-written JavaScript ergonomics layer and documented only with JSDoc. That layer is gone:
the binding and its type declarations are now generated from annotated Rust.

### Added

- **TypeScript declarations.** `index.d.ts` ships with the package, with doc comments on
  every class, method and enum member. Previous releases published no types.
- **`Analyzer.analyzeAsync`**, running the analysis model on a worker thread. The SDK's
  analysis models are too expensive for an audio thread, and Node cannot move the analyzer
  into a worker the way the Rust SDK's collector/analyzer split allows, so this is how that
  capability is reached here. There is no `AnalyzerAsync` class: only this one call moves
  off-thread, and `buffer` stays synchronous and lock-free so audio can keep arriving while
  an analysis is in flight.
- **`ProcessorAsync` and `VadAsync`**, mirroring the Rust SDK. Each call returns a promise
  and runs on Node's libuv thread pool, keeping enhancement and detection off the event
  loop. `process` copies its input and resolves to the samples rather than writing in place,
  so the caller's array stays valid while the promise is pending. Parallelism is across
  instances: give each stream its own, and raise `UV_THREADPOOL_SIZE` to run more than four
  at once.
- `Model.download` is asynchronous and resolves to the model path, so a cold download no
  longer blocks the event loop.

### Changed

The API was modernized:

| 0.23                             | 0.24                        |
| -------------------------------- | --------------------------- |
| `Model.download(...)` (blocking) | `await Model.download(...)` |
| `analyzerPair(model, key)`       | `new Analyzer(model, key)`  |
| `collector.buffer(...)`          | `analyzer.buffer(...)`      |
| `OtelConfig.enabled()`           | `{ enable: true }`          |
| `VadContext.rawVadProbability()` | `VadContext.getRawVadProbability()` |

- `analyzerPair()` and the separate `Collector` are replaced by a single `Analyzer` class
  with `buffer()` and `analyze()`. The SDK separates collection from analysis so the
  halves can live on different threads; that does not apply in Node, where an instance cannot
  cross into another worker.
- `OtelConfig` is a plain object (`{ enable, sessionId?, exportIntervalMs? }`) rather than a
  class with static factories, still passed as the optional third constructor argument.
- `ProcessorParameter` and `VadParameter` are real enums with stable numeric values
  (`Bypass = 0`, `EnhancementLevel = 1`; `SpeechHoldDuration = 0`, `Sensitivity = 1`,
  `MinimumSpeechDuration = 2`).
- Minimum supported Node version is 18.

### Removed

- `FileAnalyzer`. Its convenience windowing is not yet reimplemented on the new binding;
  window over `Analyzer` directly in the meantime.

## 0.23.0 - 2026-08-11

This release updates the underlying ai-coustics SDK to 0.23.0.

### Breaking Changes

#### New model file version

This release requires model file version 7. Re-download your models so the SDK does not reject them
with a "model version is not supported" error. See the
[compatibility matrix](https://docs.ai-coustics.com/reference/sdk/compatibility-matrix).

```javascript
const { Model, getCompatibleModelVersion } = require('@ai-coustics/aic-sdk')

// Reports the model file version this SDK build expects.
console.log(getCompatibleModelVersion()) // 7

// Re-download the models your integration uses.
const modelPath = Model.download('quail-vf-2.2-s-16khz', './models')
```

### New Features

#### Tyto 1.0 has been replaced by Tyto 1.1

The analysis model is now Tyto 1.1, `tyto-1.1-l-16khz`. Tyto 1.0 (`tyto-l-16khz`) is not loadable by
this SDK version any more.

Before:

```javascript
const modelPath = Model.download('tyto-l-16khz', './models')
```

After:

```javascript
const modelPath = Model.download('tyto-1.1-l-16khz', './models')
```

#### Analysis result fields changed

The `AnalysisResult` objects returned by `FileAnalyzer.analyze()` and `Analyzer.analyzeBuffered()`
gained a field and lost one:

- Added: `codecDegradation`, a measure of artifacts introduced by lossy speech codecs. Like the
  other fields it ranges from 0.0 to 1.0, and lower values indicate less problematic audio.
- Removed: `mediaSpeech`.

### Bug Fixes

- `Analyzer.analyzeBuffered()` no longer crashes when OpenTelemetry reporting is enabled.

## 0.22.0 - 2026-08-07

This release contains two breaking changes that affect every integration:

- **All audio APIs are mono only.** The multi-channel process/buffer methods are gone.
- **The VAD is its own type.** Voice activity detection runs on dedicated VAD models through
  `Vad`, and can no longer be derived from a processor.

Both migrations are covered step by step below.

### Breaking Changes

#### Multi-channel support removed

The processor and the analyzer's collector now operate on mono audio only.

All models process mono inputs. Previously the processor mixed all input channels down to mono
internally, which could lead to surprising results. To prevent misunderstandings, all APIs now take
exclusively mono inputs.

To process multi-channel audio, downmix to mono before calling `Processor.process()`, or create a
separate processor instance per channel.

- `Processor.processPlanar()`, `processInterleaved()` and `processSequential()` are replaced by a
  single `Processor.process()` that takes a mono `Float32Array`. The same applies to
  `Collector.bufferPlanar()`, `bufferInterleaved()` and `bufferSequential()`, which are replaced by
  `Collector.buffer()`.
- The channel-count argument is removed from `Processor.initialize()` and
  `Collector.initialize()`. The layout choice and channel count added surface area without adding
  capability, since processing always mixed every channel down to mono internally.
- Frame terminology is replaced by block-size terminology throughout, matching the mono C API. With
  mono audio a frame is a single sample, so "number of frames" and "block size" describe the same
  value:
  - `Model.getOptimalNumFrames()` is now `Model.getOptimalBlockSize()`.
  - The `numFrames` and `allowVariableFrames` arguments of `initialize()` are now `blockSize` and
    `variableBlockSize`.
- The OpenTelemetry `audio.channels` metric has been kept for backwards compatibility, but it now
  always reports exactly one channel.

Before:

```javascript
// Stereo in, stereo out. The SDK mixed both channels down to mono internally.
const processor = new Processor(model, licenseKey)
processor.initialize(sampleRate, 2, numFrames, false)
processor.processPlanar([left, right])
```

After:

```javascript
const processor = new Processor(model, licenseKey)
processor.initialize(sampleRate, blockSize, false)

// Downmix to mono yourself, then process a single buffer in place.
const mono = new Float32Array(blockSize)
for (let i = 0; i < blockSize; i++) {
  mono[i] = 0.5 * (left[i] + right[i])
}

processor.process(mono)
```

If you need per-channel output instead of a downmix, create one processor per channel and call
`Processor.process()` once per channel with that channel's buffer.

The same applies to the analyzer: downmix multi-channel audio before calling `Collector.buffer()`,
or create a separate collector/analyzer pair per channel.

#### VAD moved into its own type, energy-based VAD removed

Voice activity detection is no longer a side effect of enhancement. It is now a first-class type,
`Vad`, that runs a dedicated VAD model such as `vad-2.1-xxs-16khz`.

Energy-based VADs, which inferred speech activity from the output level of an enhancement model,
have been removed. They were an approximation and their accuracy depended on the enhancement model
in use. A dedicated VAD model is trained for the task and is considerably more accurate.

- `Processor.getVadContext()` is removed. Create a `Vad` from a VAD model and read its prediction
  through `Vad.getContext()` instead.
- A `Processor` accepts only enhancement and bypass models, and a `Vad` accepts only VAD models.
  Every other model type is rejected with a "model type is not supported by this operation" error.
- The VAD advances on `Vad.process()` instead of whenever the processor processed audio.
- The `VadParameter.Sensitivity` range is now always 0.0 to 1.0, the probability threshold of the
  VAD model output. The 1.0 to 15.0 energy-threshold range of the removed energy-based VAD is gone.
- `ProcessorContext.reset()` no longer resets any VAD state. Use `VadContext.reset()` for the VAD.
- `Processor.getProcessorContext()` is renamed to `Processor.getContext()`.

Before:

```javascript
// One model, one processor: enhancement and VAD were coupled.
const processor = new Processor(model, licenseKey)
processor.initialize(sampleRate, 1, numFrames, false)

const vadContext = processor.getVadContext()
vadContext.setParameter(VadParameter.Sensitivity, 5.0) // energy threshold

// The VAD updated as a side effect of enhancement.
processor.processInterleaved(audio)

console.log('Speech detected:', vadContext.isSpeechDetected())
```

After:

```javascript
// Load a dedicated VAD model and create a `Vad` from it.
const vadModel = Model.fromFile('path/to/vad_model.aicmodel')

// Throws if the model is not a VAD model.
const vad = new Vad(vadModel, licenseKey)
vad.initialize(sampleRate, blockSize, false)

const vadContext = vad.getContext()
vadContext.setParameter(VadParameter.Sensitivity, 0.8) // probability

// The VAD is driven explicitly and does not modify the audio.
vad.process(audio)

console.log('Speech detected:', vadContext.isSpeechDetected())
```

##### Run the VAD on the original audio

If you use enhancement and VAD together, **feed the VAD the original input audio, not the
processor's enhanced output.** Run the two side by side on the same mono block rather than chaining
them:

```javascript
// Recommended: both see the same original input block.
vad.process(audio) // reads the block, does not modify it
processor.process(audio) // enhances the block in place
```

`Vad.process()` leaves the buffer untouched, so calling it on the same buffer before
`Processor.process()` is all it takes to keep the VAD on the unprocessed signal.

Enhancement is designed to change the signal, so running the VAD on its output means detecting
speech in audio that no longer matches what the VAD model expects. It also stacks the processor's
delay on top of the VAD's own prediction delay, which makes speech decisions harder to align.

##### Delay queries renamed

There is no single "output delay" any more. The processor delays audio, the VAD does not, so the two
queries are now named after what they actually report:

- `ProcessorContext.getOutputDelay()` is now `ProcessorContext.getAudioDelay()`. It is an **audio**
  delay: the enhanced samples leave `Processor.process()` that many samples behind their input.
- `VadContext.getPredictionDelay()` replaces the processor-driven delay query for the VAD. It is a
  **prediction** delay and is _not_ applied to the audio, since `Vad.process()` leaves the buffer
  untouched. It tells you how far behind its own input the published prediction is, so you can line
  speech decisions up with the audio timeline.

With both fed from the same input block, the two delays are independent of each other:

```javascript
const audioDelay = procCtx.getAudioDelay()
const predictionDelay = vadContext.getPredictionDelay()

// The enhanced audio lags the input by `audioDelay`.
// The VAD prediction lags the same input by `predictionDelay`.
```

`Vad` mirrors the processor's lifecycle and control surface:

- `Vad.initialize()`, `Vad.process()` and `Vad.terminateSession()`, plus an optional `OtelConfig`
  as the third constructor argument
- `Vad.getContext()` for thread-safe control handles
- `VadContext.reset()`, `VadContext.getPredictionDelay()`, `VadContext.updateBearerToken()`
- `VadContext.isSpeechDetected()`, `VadContext.rawVadProbability()`, `VadContext.setParameter()`,
  `VadContext.getParameter()`

See [`examples/vad.js`](examples/vad.js) for a complete example.

### New Features

- Added `Processor.terminateSession()`, `Vad.terminateSession()` and
  `Analyzer.terminateSession()` to end a telemetry session on demand instead of waiting for the
  processor, VAD or analyzer to be garbage collected. This is useful in integrations where object
  deallocation may be delayed. After termination the processor and VAD may no longer process audio
  and the analyzer may no longer analyze buffered audio.

  ```javascript
  // Ends the telemetry session without waiting for the object to be collected.
  processor.terminateSession()
  ```

### Bug Fixes

- Resetting the VAD state through `VadContext.reset()` now immediately clears the published speech
  detection and raw VAD probability values, so `isSpeechDetected()` and `rawVadProbability()` no
  longer return stale values from the previous stream after a reset.

## 0.21.0 - 2026-07-22

### New Features

This release includes a new `VadContext.rawVadProbability()` API to read the raw output of a VAD model.

### Changes

Reduced the necessary output delay of the `Processor` when using `allowVariableFrames = true`.

## 0.20.0 - 2026-06-15

### New Features

This release includes several new APIs for running our newest audio intelligence model, _Tyto_.

Analysis models score audio quality instead of enhancing it. Each result reports a headline
`riskScore` alongside individual measures for speaker reverb, speaker loudness, interfering
speech, media speech, noise and packet loss.

The new APIs introduce two new concepts: the `Collector` and the `Analyzer`, created together
with `analyzerPair`.

- The `Collector` is designed to be placed in the audio thread, buffering audio chunks for later analysis.
- The `Analyzer` is designed to be run separately. Analysis models are computationally expensive and cannot run in the audio thread. The analyzer has access to the audio buffered by the collector, and it can access it safely across threads.

Initialize the `Collector` with the same configuration as your existing `Processor` and you can
call the `collector.buffer*` methods in the same manner as the `processor.process*` methods.

Call `analyzer.analyzeBuffered()` separately to obtain an analysis of the latest audio buffered
by the `Collector`.

For audio that is already loaded in memory, the `FileAnalyzer` convenience wrapper analyzes
complete mono buffers in fixed five-second windows, so you do not have to manage a
collector/analyzer pair yourself.

## 0.19.0 - 2026-06-03

### Features

- Added JWT bearer token refresh via `ProcessorContext.updateBearerToken`. When the processor was created with a JWT license, this swaps in a renewed token while audio processing continues uninterrupted. If either the originally configured key or the new token is not a JWT, an error is thrown and the existing token stays in use.
- `VadParameter.Sensitivity` is now also supported on dedicated VAD models (e.g. Quail VAD), where the value is interpreted as the speech probability threshold in the range 0.0 to 1.0. Energy-based VADs continue to use the existing 1.0 to 15.0 range. The default is now model-specific.
- Added `OtelConfig.exportIntervalMs` to control how often OpenTelemetry metrics are exported. Set to 0 to keep the SDK default of 60000 ms.
- Added `OtelConfig` for per-processor OpenTelemetry control. Pass an instance as the third argument to `Processor` to override the `AIC_SDK_OTEL_ENABLE` environment setting for that processor only. Use `OtelConfig.enabled()`, `OtelConfig.disabled()`, or `OtelConfig.withSessionId(sessionId)` to construct one.

## 0.17.1 - 2026-05-07

### Improvements

- Increased maximum VAD speech hold duration from 100x to 300x the model's window size.

### Bug Fixes

- Removed zero-padding when the host frame size does not match the model frame size, which caused unexpected behavior for some models.

## 0.17.0 - 2026-04-24

### New Features

- Added support for Quail Voice Focus 2.1 models.
- This release adds an experimental feature to export real-time audio processing metrics via OpenTelemetry (OTel). The new feature is currently disabled by default and available for testing on early access only.

### Breaking Changes

- Quail Voice Focus 2.0 is no longer supported.
- Compatible model file version was bumped to 3.

## 0.15.1 - 2026-03-26

### Improvements

- Improved performance of telemetry when using multiple processors.

### Fixes

- The scaling factor of the STFT now changes depending on the sample rate.

## 0.15.0 - 2026-03-25

### New features

- Support for V2 model files, which includes support for the new Quail Voice Focus 2.0 model.

### Improvements

- The parameters of Quail models are no longer fixed. The enhancement level of every model can now be adjusted between 0.0 and 1.0.

### Breaking Changes

- V1 model files are no longer supported.
- The parameter `ProcessorParameter.VoiceGain` was removed.
- The parameter `VadParameter.SpeechHoldDuration` previously held detected speech for half of the specified duration. It has now been changed to better represent the intention of the developer.
- The default value for `VadParameter.SpeechHoldDuration` was changed from 50 ms to 30 ms to match the existing behavior.

### Fixes

- `VadContext.setParameter` no longer returns an error when trying to set a valid speech hold duration value before calling `Processor.initialize`.

## 0.14.0 - 2026-01-26

### Improvements

- Increased the maximum speech hold duration of the VAD from 20 to 100x the model's window size.

### Fixes

- Fixed an issue causing the VAD's state to be reset on every process\* call.

## 0.13.0 - 2026-01-20

This release comes with a number of new features and several breaking changes. Most notably, the library no longer includes any models, which significantly reduces the package size. The models are now available separately for download at https://artifacts.ai-coustics.io.

### Important Changes

- **New license keys required**: License keys previously generated in the [developer portal](https://developers.ai-coustics.io) will no longer work. New license keys must be generated.
- **Model naming changes**:
  - Quail models are now called "Sparrow" – These models are optimized for human-to-human enhancement (e.g., voice calls, conferencing).
  - Quail-STT models are now called "Quail" – These models are optimized for human-to-machine enhancement (e.g., Speech-to-Text applications).
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
// Old (0.12)
const { Model, ModelType, EnhancementParameter, VadParameter } = require('@ai-coustics/aic-sdk')

const model = new Model(ModelType.QuailL48, licenseKey)
model.initialize(48000, 1, 480, false)
model.setParameter(EnhancementParameter.EnhancementLevel, 0.8)
model.processInterleaved(audio)

const vad = model.createVad()
vad.setParameter(VadParameter.Sensitivity, 5.0)
if (vad.isSpeechDetected()) {
  console.log('Speech!')
}

// New (0.13)
const { Model, Processor, ProcessorParameter, VadParameter } = require('@ai-coustics/aic-sdk')

const modelPath = Model.download('sparrow-l-48khz', '/tmp/models')
const model = Model.fromFile(modelPath)
// Or load directly: const model = Model.fromFile("/path/to/sparrow-l-48khz.aicmodel");

const processor = new Processor(model, licenseKey)
processor.initialize(48000, 1, 480, false)

const ctx = processor.getProcessorContext()
ctx.setParameter(ProcessorParameter.EnhancementLevel, 0.8)
processor.processInterleaved(audio)

const vad = processor.getVadContext()
vad.setParameter(VadParameter.Sensitivity, 5.0)
if (vad.isSpeechDetected()) {
  console.log('Speech!')
}
```

## 0.12.0 - 2025-12-15

### New features

- Added new Quail Voice Focus STT model (`QuailVfSttL16`), purpose-built to isolate and elevate the foreground speaker while suppressing both interfering speech and background noise.
- Added new variants of the Quail STT model: `QuailSttL8`, `QuailSttS16` and `QuailSttS8`.
- Added new VAD parameter `VadParameter.MinimumSpeechDuration` used to control for how long speech needs to be present in the audio signal before the VAD considers it speech.

### Breaking changes

- `QuailXS` was renamed to `QuailXs`
- `QuailXXS` was renamed to `QuailXxs`
- `QuailSTT` was replaced with specific STT model variants: `QuailSttL16`, `QuailSttL8`, `QuailSttS16`, `QuailSttS8`
- Replaced VAD parameter `VadParameter.LookbackBufferSize` with `VadParameter.SpeechHoldDuration`, used to control for how long the VAD continues to detect speech after the audio signal no longer contains speech.

### Fixes

- VAD now works correctly when `EnhancementParameter.EnhancementLevel` is set to 0 or `EnhancementParameter.Bypass` is enabled (previously non-functional in these cases)

## 0.10.0 - 2025-11-28

### Wrapper Overhaul

- **Switched from C++ to Rust SDK with Neon** for improved safety and maintainability
- **Pre-built platform libraries** for all supported targets, enabling much faster installation

### New Features

**Speech Enhancement & Models:**

- **Quail STT Model** (v0.10.0): New speech enhancement model optimized for human-to-machine interaction (voice agents, speech-to-text), operates at 16 kHz native sample rate with fixed enhancement parameters
- **Voice Activity Detection (VAD)** (v0.9.0): Quail-based VAD that automatically calculates voice activity predictions from model output

**Platform Support:**

- **Windows ARM64 support** (v0.9.1)

**Licensing & Usage:**

- **Self-Service Licenses** (v0.8.0): Direct license access from development portal
- **Usage-Based Telemetry** (v0.8.0): Collects processing time and diagnostic data (no audio content collected). Requires constant internet connection; offline licenses available on request

**Processing Improvements:**

- **Variable Frame Processing** (v0.7.0): Support for variable number of frames per call (results in higher processing delay when enabled)
- **Bypass Parameter** (v0.7.0): New parameter to bypass audio processing while preserving algorithmic delay for seamless transitions

## 0.6.3 - 2025-10-06

Initial release
