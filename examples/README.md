# Examples

Runnable scripts for each part of the SDK.

| Example                | Shows                                                     |
| ---------------------- | --------------------------------------------------------- |
| `enhancement.js`       | Speech enhancement, in place on the calling thread        |
| `enhancement-async.js` | The same on a worker thread, then several streams at once |
| `vad.js`               | Voice activity detection and its parameters               |
| `vad-async.js`         | Async detection, and detection combined with enhancement  |
| `analysis.js`          | Audio quality scoring, blocking and on a worker thread    |
| `file-processing.js`   | A WAV file end to end, with delay compensation            |

Analysis needs no separate async script: only `analyzeAsync` moves off the calling thread, so
both forms live in `analysis.js`. File processing has no async counterpart because it does not need
one: a batch job has no event loop to keep free, and the sync API is the simpler tool. For
parallel batch work, run several processes.

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

`--model` tries a different model and `--help` lists every option. A model only enhances up
to its own Nyquist limit, so pair a 48 kHz source with a 48 kHz model such as `rook-l-48khz`.
Browse the catalogue at [artifacts.ai-coustics.io](https://artifacts.ai-coustics.io).

## Choosing between sync and async

`Processor` and `Vad` do their work on the thread that calls them. That is what you want on a
dedicated audio thread, where a promise per block would only add overhead.

`ProcessorAsync` and `VadAsync` run on Node's libuv thread pool, so the event loop stays
responsive. That matters when something else is waiting on it, as in a server handling live
streams alongside its sockets and HTTP. It buys a batch script nothing. Two differences to
keep in mind:

- `process` does not write into the array it is given. It copies the input, so that array
  stays valid while the promise is pending, and resolves to the samples instead.
- One instance handles one stream, and calls on it must not overlap: worker threads finish
  out of order, which would desync the stream. Parallelism comes from running several
  instances, as the end of `enhancement-async.js` shows.

The pool is four threads by default and is shared with `fs`, `dns` and `crypto`. Raise
`UV_THREADPOOL_SIZE` before Node starts to run more streams in parallel. The core SDK's
`AIC_NUM_THREADS` has no effect on these bindings.
