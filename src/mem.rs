//! Reports the native footprint of SDK objects to V8's garbage collector.
//!
//! Each binding class is a small JS object of a few dozen bytes in front of a much larger
//! native allocation, from ~200 KiB for a processor up to the size of the model weights.
//! V8's heuristics only see the JS side: `heapUsed` and `external` barely move, so the
//! collector feels no pressure to reclaim dropped instances, and a workload that creates
//! processors per unit of work ratchets RSS up until the process is OOM-killed.
//!
//! `Env::adjust_external_memory` (`napi_adjust_external_memory`) is the Node-API mechanism
//! for reporting that hidden cost. Each constructor reports its object's footprint, and the
//! negation is reported when the instance goes away: by `dispose()`, by
//! [`DisposableSlot::release`](crate::disposable_slot::DisposableSlot::release), or by the
//! class finalizer. Either way the ledger balances.
//!
//! Footprints are per-class constants because the SDK exposes no per-instance memory
//! query. They are estimates keyed to measurement and deliberately err high: over-reporting
//! only makes V8 collect a little more eagerly, while under-reporting leaves the growth
//! above unchecked.

use std::path::Path;

use napi::Env;

const MIB: i64 = 1024 * 1024;
const KIB: i64 = 1024;

/// A `Processor` or `Vad` instance. Measured as the RSS delta per instance, at initialize
/// plus one `process` call:
///
/// - `quail-vf-2.2-s` (5 MiB model): ~190 KiB
/// - `quail-vf-2.2-l` (20 MiB model): ~462 KiB
/// - `vad-2.1-xxs` (0.6 MiB model): ~197 KiB
///
/// The workspace barely scales with the weights (those stay file-backed under `Model`),
/// so 512 KiB covers the largest measured enhancement model with headroom while staying
/// within ~3x of the smallest.
pub(crate) const PROCESSOR_BYTES: i64 = 512 * KIB;

/// An `Analyzer` (collector + analyzer pair). Measured ~8.2 MiB for `tyto-1.1-l` at
/// construction and ~8.9 MiB with the collector initialized and holding 5 s of audio.
/// 16 MiB gives ~2x headroom for larger analysis models.
pub(crate) const ANALYZER_BYTES: i64 = 16 * MIB;

/// Fallback footprint for a `Model` when its file cannot be stat'd. Deliberately
/// conservative: the loaded model is memory-mapped, so its resident share approaches the
/// file size as pages are touched.
const MODEL_FALLBACK_BYTES: i64 = 64 * MIB;

/// Tells V8 that `delta_bytes` of external (native) memory changed.
///
/// Positive when an object is created, negative (the same value) when it is finalized.
/// The result is a GC hint only: a failed adjustment is never worth failing the API call
/// over, so errors are ignored.
pub(crate) fn adjust(env: Env, delta_bytes: i64) {
  if delta_bytes == 0 {
    return;
  }

  // A non-Ok status only means the hint was not applied; correctness does not depend on
  // it, and there is nothing useful to do about a failed hint anyway.
  let _ = env.adjust_external_memory(delta_bytes);
}

/// The resident footprint to report for a model loaded from `path`: the file size, since
/// the weights are memory-mapped, falling back to a conservative estimate.
pub(crate) fn model_bytes(path: &Path) -> i64 {
  std::fs::metadata(path)
    .map(|meta| meta.len() as i64)
    .unwrap_or(MODEL_FALLBACK_BYTES)
}
