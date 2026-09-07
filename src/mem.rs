//! Reports estimated native memory usage to V8's garbage collector.
//!
//! V8 cannot infer native allocations from the small JavaScript wrapper objects.
//! `DisposableSlot` adds an estimate on construction and subtracts it on explicit
//! release or finalization. This helps GC account for models and processing state.
//!
//! The SDK has no per-instance memory query. The constants below are rounded-up
//! measurements; model estimates use the file size.

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
/// The weights stay file-backed under `Model`, so the workspace scales only weakly with
/// model size. 512 KiB covers the largest measured model with headroom and stays within
/// ~3x of the smallest.
pub(crate) const PROCESSOR_BYTES: i64 = 512 * KIB;

/// The analyzer half of an `Analyzer`, which holds the model workspace. Measured ~8.2 MiB
/// for `tyto-1.1-l` at construction, so 14 MiB leaves ~1.7x headroom for larger analysis
/// models.
///
/// Reported separately from [`COLLECTOR_BYTES`] because the two halves are destroyed
/// independently: the collector can go while a worker thread still analyzes, so a single
/// report for the pair would be released too early.
pub(crate) const ANALYZER_BYTES: i64 = 14 * MIB;

/// The collector half of an `Analyzer`, which holds the buffered audio. Measured as the
/// ~0.7 MiB that `tyto-1.1-l` grows by once the collector is initialized and holding its
/// 5 s span, so 2 MiB leaves ~3x headroom.
pub(crate) const COLLECTOR_BYTES: i64 = 2 * MIB;

/// Fallback footprint for a `Model` when its file cannot be stat'd. The weights are
/// memory-mapped, so the resident share approaches the file size as pages are touched.
const MODEL_FALLBACK_BYTES: i64 = 64 * MIB;

/// Tells V8 that `delta_bytes` of external (native) memory changed.
///
/// Positive when an object is created, negative (the same value) when it is finalized.
/// This is only a GC hint, so a failed adjustment is ignored.
pub(crate) fn adjust(env: Env, delta_bytes: i64) {
  if delta_bytes == 0 {
    return;
  }

  let _ = env.adjust_external_memory(delta_bytes);
}

/// The footprint to report for a model loaded from `path`. The weights are memory-mapped,
/// so this is the file size, or [`MODEL_FALLBACK_BYTES`] when the file cannot be stat'd.
pub(crate) fn model_bytes(path: &Path) -> i64 {
  std::fs::metadata(path)
    .map(|meta| meta.len() as i64)
    .unwrap_or(MODEL_FALLBACK_BYTES)
}
