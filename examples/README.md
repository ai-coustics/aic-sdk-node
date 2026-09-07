# Examples

Runnable scripts for each part of the SDK.

| Example                | Shows                                                     |
| ---------------------- | --------------------------------------------------------- |
| `enhancement.js`       | Speech enhancement, in place on the calling thread        |
| `enhancement-async.js` | Async speech enhancement and concurrent streams           |
| `vad.js`               | Voice activity detection and its parameters               |
| `vad-async.js`         | Async detection, and detection combined with enhancement  |
| `analysis.js`          | Audio quality scoring, blocking and on a worker thread    |
| `file-processing.js`   | WAV file enhancement with delay compensation              |

`analysis.js` demonstrates both `analyze` and `analyzeAsync`. The file processing example
uses synchronous processing. For parallel batch processing, run several processes.

## Setup

Install and build the addon from a checkout of this repository:

```bash
pnpm install
pnpm build
```

Then set your license key, from
[developers.ai-coustics.com](https://developers.ai-coustics.com):

```bash
export AIC_SDK_LICENSE="your-license-key"
```

Each example downloads the model it needs into `./models` on first run.

## Running

```bash
node examples/enhancement.js
node examples/enhancement-async.js

node examples/vad.js
node examples/vad-async.js

node examples/analysis.js
```

The file example takes a WAV path. It also needs `wavefile`, which `pnpm install` already
provides in this repository; outside it, install it alongside the SDK.

```bash
node examples/file-processing.js --input speech.wav
node examples/file-processing.js --input speech.wav --output enhanced.wav --enhancement 0.7
```

`--model` selects the model and `--help` lists all options. A model only enhances up
to its own Nyquist limit, so pair a 48 kHz source with a 48 kHz model such as `rook-l-48khz`.
Browse the catalogue at [artifacts.ai-coustics.io](https://artifacts.ai-coustics.io).

## Choosing between sync and async

`Processor` and `Vad` run on the calling thread. Use them in a dedicated worker or a batch
script where blocking is acceptable.

`ProcessorAsync` and `VadAsync` run processing on Node's libuv thread pool, keeping the event
loop available for other work. Their constructors and `dispose()` methods are synchronous.

- `process` copies the input and returns a promise for a new array. The input remains
  unmodified. Enhancement returns enhanced samples; VAD returns the original samples.
- Await each operation before submitting the next on the same instance. Calls are not
  guaranteed to execute in submission order. Use one instance per stream to process
  multiple streams concurrently.

The pool defaults to four threads and is shared with filesystem, DNS and crypto work. Set
`UV_THREADPOOL_SIZE` before starting Node to change its size. `AIC_NUM_THREADS` does not apply
to these bindings.
