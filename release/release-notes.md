### New Features

- Added a standalone `Vad` API backed by dedicated VAD models, with its own `initialize()`,
  `process()`, `context()`, and `terminateSession()` methods.
- Added `VadContext.reset()`, `VadContext.getOutputDelay()`, and
  `VadContext.updateBearerToken()`.
- Added `terminateSession()` to `Processor` and `Analyzer`.

### Breaking Changes

- Removed processor-owned VAD contexts and energy-based VAD. Create a `Vad` from a dedicated VAD
  model such as `vad-2.1-xxs-16khz` instead.
- Renamed `Processor.getProcessorContext()` to `Processor.getContext()`.
- Renamed `Model.getOptimalNumFrames()` to `Model.getOptimalBlockSize()` and replaced frame
  terminology with block-size terminology throughout the API.
- Removed the channel-count argument from `Processor.initialize()` and `Collector.initialize()`.
- Replaced the interleaved, sequential, and planar processor methods with mono-only
  `Processor.process()`. The collector now similarly exposes only `Collector.buffer()`.
  Applications with multi-channel audio must downmix to mono before processing or collection.
- VAD sensitivity is now always a probability threshold in the range 0.0 to 1.0.
