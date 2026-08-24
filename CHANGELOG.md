# Changelog

## 0.24.0

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

- `analyzerPair()` and the separate `Collector` are replaced by a single `Analyzer` class
  with `buffer()` and `analyzeBuffered()`. The SDK separates collection from analysis so the
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
