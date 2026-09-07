# @ai-coustics/aic-sdk

Node.js bindings for the ai-coustics SDK: speech enhancement, voice
activity detection and audio analysis.

For product documentation see [docs.ai-coustics.com](https://docs.ai-coustics.com).

> [!NOTE]
> This SDK requires a license key. Generate one at
> [developers.ai-coustics.com](https://developers.ai-coustics.com).

## Installation

```bash
npm install @ai-coustics/aic-sdk
```

Prebuilt binaries are published for macOS (x64, arm64), Linux (x64, arm64, glibc) and
Windows (x64, arm64, MSVC). The native SDK is linked statically, so there is no separate
library to install or put on a search path.

## Quick start

```javascript
const { Model, Processor } = require('@ai-coustics/aic-sdk')

async function main() {
  // Download a model once, or fetch one manually from https://artifacts.ai-coustics.io
  const modelPath = await Model.download('quail-vf-2.2-s-16khz', './models')
  const model = Model.fromFile(modelPath)

  // The model's own settings give the lowest delay
  const sampleRate = model.getOptimalSampleRate()
  const blockSize = model.getOptimalBlockSize(sampleRate)

  const processor = new Processor(model, process.env.AIC_SDK_LICENSE)
  processor.initialize(sampleRate, blockSize)

  // Enhance a mono block in place
  const audio = new Float32Array(blockSize)
  processor.process(audio)
}

main()
```

Processing is mono. For multichannel audio, mix down to mono or use one processor per
channel.

The snippets below are fragments, and each one leaves out that surrounding `async function`
for brevity. Keep it: `await` at the top level of a CommonJS file is a syntax error, and
several calls here are asynchronous.

Runnable scripts for enhancement, VAD, analysis and whole-file processing, synchronous and
async, are in [`examples/`](examples).

## Models

Available models and their ids are listed at
[artifacts.ai-coustics.io](https://artifacts.ai-coustics.io). Each class accepts exactly one
family of models and throws for the rest:

| Class                         | Accepted models     |
| ----------------------------- | ------------------- |
| `Processor`, `ProcessorAsync` | enhancement, bypass |
| `Vad`, `VadAsync`             | dedicated VAD       |
| `Analyzer`                    | analysis            |

`Model.download` resolves to the model's path and runs off the event loop. Model files are
memory-mapped rather than read into memory, so keep the file in place while anything created
from it is alive.

## Enhancement

Parameters can be changed while audio is being processed, through a context handle:

```javascript
const { ProcessorParameter } = require('@ai-coustics/aic-sdk')

const context = processor.getContext()

context.setParameter(ProcessorParameter.EnhancementLevel, 0.8)
context.setParameter(ProcessorParameter.Bypass, 0)

console.log(context.getParameter(ProcessorParameter.EnhancementLevel))

// Samples of delay the processor adds, for lining the output up with other streams
console.log(context.getAudioDelay())

// Clear internal state on a stream discontinuity or seek
context.reset()
```

## Off the main thread

`ProcessorAsync` and `VadAsync` do the same work as `Processor` and `Vad`, but each call
returns a promise and runs on a worker thread, so the event loop stays responsive. Use them
when other work shares that loop, as in a server handling live streams alongside its sockets
and HTTP. The synchronous classes are the pick on a dedicated audio thread or in a batch
script,
where nothing else needs the loop and a promise per block would only add overhead.

```javascript
const { Model, ProcessorAsync } = require('@ai-coustics/aic-sdk')

const processor = await new ProcessorAsync(model, process.env.AIC_SDK_LICENSE).withConfig(sampleRate, blockSize)

// Unlike the synchronous class, this does not write into the caller's array. It resolves
// to the enhanced samples, so a streaming loop reuses the same variable
let audio = new Float32Array(blockSize)
for (;;) {
  audio = await processor.process(audio)
}
```

The input is copied before the work is queued, so it stays valid and untouched while the
promise is pending. `VadAsync.process` hands the block back unmodified in the same way.

Context handles are awaited but their methods stay synchronous, so a prediction or parameter
can still be read from inside an audio callback:

```javascript
const context = await processor.getContext()
context.setParameter(ProcessorParameter.EnhancementLevel, 0.8)
```

### Running several streams

One instance handles one stream. Do not start a second `process` on the same instance before
the first resolves: worker threads complete out of order, which would desync the stream. Give
each stream its own instance instead.

```javascript
const processors = await Promise.all(
  streams.map(() => new ProcessorAsync(model, licenseKey).withConfig(sampleRate, blockSize)),
)

const enhanced = await Promise.all(processors.map((processor, i) => processor.process(blocks[i])))
```

Work runs on Node's libuv thread pool, which is four threads by default and shared with
`fs`, `dns` and `crypto`. To run more streams in parallel, raise `UV_THREADPOOL_SIZE` before
Node starts:

```bash
UV_THREADPOOL_SIZE=16 node server.js
```

The core SDK's own `AIC_NUM_THREADS` has no effect here: it sizes a thread pool these
bindings deliberately do not use, so that all audio work stays on the pool Node already
manages.

## Voice activity detection

VAD runs a dedicated VAD model and is driven independently of any processor.

```javascript
const { Model, Vad, VadParameter } = require('@ai-coustics/aic-sdk')

const vadModel = Model.fromFile(await Model.download('vad-2.1-xxs-16khz', './models'))
const vad = new Vad(vadModel, process.env.AIC_SDK_LICENSE)

const sampleRate = vadModel.getOptimalSampleRate()
vad.initialize(sampleRate, vadModel.getOptimalBlockSize(sampleRate))

const context = vad.getContext()
context.setParameter(VadParameter.Sensitivity, 0.8)

vad.process(block) // reads the block, does not modify it

if (context.isSpeechDetected()) {
  console.log('speech')
}

// Raw model output, before speech-hold and thresholding
console.log(context.getRawVadProbability())
```

### Run the VAD on the original audio

When enhancement and detection run together, feed the VAD the **original** input, not the
processor's output. Enhancement is designed to change the signal, so detecting on its output
means running the VAD on audio that no longer matches what its model expects, and it stacks
the processor's delay on top of the prediction delay. Because `vad.process` leaves its input
untouched, running both on the same block is enough:

```javascript
vad.process(block) // reads the block
processor.process(block) // enhances it in place
```

The two delays describe different things and are independent:

```javascript
context.getAudioDelay() // enhanced audio lags the input by this many samples
vadContext.getPredictionDelay() // the VAD decision lags the same input by this many
```

The prediction delay is not applied to the audio; use it to line speech decisions up with
the audio timeline.

## Analysis

Analysis models score audio quality. Buffering is cheap enough for the audio path;
`analyze` runs the model and is not.

```javascript
const { Model, Analyzer } = require('@ai-coustics/aic-sdk')

const analysisModel = Model.fromFile(await Model.download('tyto-1.1-l-16khz', './models'))
const analyzer = new Analyzer(analysisModel, process.env.AIC_SDK_LICENSE)

const sampleRate = analysisModel.getOptimalSampleRate()
analyzer.initialize(sampleRate, analysisModel.getOptimalBlockSize(sampleRate))

analyzer.buffer(block)

// Runs the model on a worker thread. `analyze()` does the same on the calling thread.
const result = await analyzer.analyzeAsync()
console.log(result.riskScore, result.noise, result.speakerReverb)
```

`buffer` is cheap enough for the audio path; running the model is not, so it is a separate
call with two forms. `analyzeAsync` is the one to reach for in a server: analysis is
occasional, so the promise costs nothing next to the model, and the event loop stays free.
`analyze` blocks and suits a CLI or a worker thread.

Only that one call moves off-thread, which is why there is no `AnalyzerAsync` class to match
`ProcessorAsync`. `buffer` stays synchronous, takes no lock, and can be called while an
analysis is still running. The SDK guarantees the collector and analyzer halves are safe to
use concurrently. The analyzer's other methods do wait for a pending analysis to finish.

Every score runs 0.0 - 1.0. Except `speakerLoudness`, lower means less problematic audio.
`riskScore` is the headline number: how likely this audio is to break downstream models such
as speech-to-text, VAD or turn-taking.

## Telemetry

Telemetry follows the runtime environment (e.g. `AIC_SDK_OTEL_ENABLE`). To override it for a
single instance:

```javascript
const processor = new Processor(model, licenseKey, {
  enable: true,
  sessionId: 'my-session',
  exportIntervalMs: 60000,
})
```

A session is closed when its object is garbage collected. Because GC timing is not
guaranteed, every processor, VAD and analyzer also exposes `terminateSession()` for
lifecycle events; afterwards the object can no longer process audio. On `ProcessorAsync`
and `VadAsync` it returns a promise, since it may block.

If your license key is a JWT, refresh it in place instead of rebuilding the object:

```javascript
context.updateBearerToken(renewedJwt)
```

## Memory management

`Model`, `Processor`, `ProcessorAsync`, `Vad`, `VadAsync` and `Analyzer` hold large native
allocations behind small JavaScript objects. The binding reports each object's native
footprint to V8 (`napi_adjust_external_memory`), so the garbage collector applies the right
amount of pressure and reclaims dropped instances promptly instead of letting native memory
grow unbounded.

For deterministic cleanup, every one of these classes also exposes `dispose()`, which
destroys the native object immediately instead of waiting for garbage collection:

```javascript
const processor = new Processor(model, licenseKey)
try {
  processor.initialize(sampleRate, blockSize)
  processor.process(block)
} finally {
  processor.dispose()
}
```

After `dispose()`, every method on the object throws; calling `dispose()` again does
nothing. On the async classes it blocks until in-flight work on the libuv pool finishes.

Two things to know about cleanup timing:

- Native cleanup runs on the event loop when the object is finalized, not synchronously at
  garbage collection. Finalizers run on event-loop turns, so batches that create many of
  these objects back to back hold native memory until the loop turns. An `await` on an
  already-resolved promise (a microtask) is not enough; real async boundaries such as I/O,
  `setTimeout` or `setImmediate` are. A tight synchronous loop that creates thousands of
  objects accumulates their native memory for the duration of the loop; create these
  objects per unit of work behind real async boundaries, or reuse a single instance.
- RSS reflects the peak of simultaneously live (or not-yet-finalized) instances: the
  allocator reuses freed native memory rather than returning it to the OS, so a burst of N
  concurrent instances costs about N x their footprint even after they are dropped.

## Development

Requires a recent Rust toolchain and Node 18+.

```bash
pnpm install
pnpm build            # release build; use build:debug while iterating
pnpm pretest          # download model fixtures into __test__/data
AIC_SDK_LICENSE=<key> pnpm test
```

The native library for the host target is downloaded during `cargo build`, so the first
build needs network access.

To benchmark, point the harness at a model file:

```bash
AIC_SDK_LICENSE=<key> AIC_SDK_MODEL=__test__/data/<model>.aicmodel pnpm bench
```

## License

This Node wrapper is distributed under the Apache 2.0 license (`LICENSE`). The core SDK it
links against is distributed under the proprietary AIC-SDK license
(`LICENSE.AIC_SDK`).
