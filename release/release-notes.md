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
const processor = new Processor(model, licenseKey);
processor.initialize(sampleRate, 2, numFrames, false);
processor.processPlanar([left, right]);
```

After:

```javascript
const processor = new Processor(model, licenseKey);
processor.initialize(sampleRate, blockSize, false);

// Downmix to mono yourself, then process a single buffer in place.
const mono = new Float32Array(blockSize);
for (let i = 0; i < blockSize; i++) {
  mono[i] = 0.5 * (left[i] + right[i]);
}

processor.process(mono);
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
const processor = new Processor(model, licenseKey);
processor.initialize(sampleRate, 1, numFrames, false);

const vadContext = processor.getVadContext();
vadContext.setParameter(VadParameter.Sensitivity, 5.0); // energy threshold

// The VAD updated as a side effect of enhancement.
processor.processInterleaved(audio);

console.log("Speech detected:", vadContext.isSpeechDetected());
```

After:

```javascript
// Load a dedicated VAD model and create a `Vad` from it.
const vadModel = Model.fromFile("path/to/vad_model.aicmodel");

// Throws if the model is not a VAD model.
const vad = new Vad(vadModel, licenseKey);
vad.initialize(sampleRate, blockSize, false);

const vadContext = vad.getContext();
vadContext.setParameter(VadParameter.Sensitivity, 0.8); // probability

// The VAD is driven explicitly and does not modify the audio.
vad.process(audio);

console.log("Speech detected:", vadContext.isSpeechDetected());
```

##### Run the VAD on the original audio

If you use enhancement and VAD together, **feed the VAD the original input audio, not the
processor's enhanced output.** Run the two side by side on the same mono block rather than chaining
them:

```javascript
// Recommended: both see the same original input block.
vad.process(audio); // reads the block, does not modify it
processor.process(audio); // enhances the block in place
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
  **prediction** delay and is *not* applied to the audio, since `Vad.process()` leaves the buffer
  untouched. It tells you how far behind its own input the published prediction is, so you can line
  speech decisions up with the audio timeline.

With both fed from the same input block, the two delays are independent of each other:

```javascript
const audioDelay = procCtx.getAudioDelay();
const predictionDelay = vadContext.getPredictionDelay();

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
  processor.terminateSession();
  ```

### Bug Fixes

- Resetting the VAD state through `VadContext.reset()` now immediately clears the published speech
  detection and raw VAD probability values, so `isSpeechDetected()` and `rawVadProbability()` no
  longer return stale values from the previous stream after a reset.
