//! Reports the native footprint of boxed SDK objects to V8's garbage collector.
//!
//! Neon hands each native object to JavaScript as a tiny `JsBox`, so V8 has no idea how
//! much native memory sits behind it (model weights, per-stream working buffers, ...).
//! Without that signal V8 feels no pressure to collect these boxes, and code that creates
//! processors/analyzers per unit of work grows until the process is OOM-killed. This is
//! the same class of bug the Ruby binding fixed with `rb_gc_adjust_memory_usage`.
//!
//! `napi_adjust_external_memory` is the Node-API equivalent. Neon 1.1 does not wrap it, so
//! we call the raw symbol (resolved from the host process at load time) using the raw
//! `napi_env` that the `sys` feature exposes via `Context::to_raw()`.

use std::ffi::c_void;

use neon::prelude::Context;

// SAFETY: `napi_adjust_external_memory` is part of the stable Node-API ABI and is provided
// by the Node host process that loads this addon. `env` is a valid `napi_env` obtained from
// an active `Context`; `adjusted_value` points to local stack storage. The env is declared as
// an opaque `*mut c_void` (ABI-identical to `napi_env`) because Neon's raw `Env` alias is not
// publicly nameable.
unsafe extern "C" {
    fn napi_adjust_external_memory(
        env: *mut c_void,
        change_in_bytes: i64,
        adjusted_value: *mut i64,
    ) -> i32;
}

/// Tells V8 that the amount of external (native) memory changed by `delta_bytes`.
///
/// Pass a positive value when a native object is created and the negation of the same value
/// when it is finalized/freed, so the two always balance. A non-zero napi status only means
/// the GC hint was not applied; it is not fatal for correctness, so it is ignored.
pub fn adjust<'a, C: Context<'a>>(cx: &mut C, delta_bytes: i64) {
    if delta_bytes == 0 {
        return;
    }

    let env = cx.to_raw() as *mut c_void;
    let mut adjusted: i64 = 0;

    // SAFETY: see the note on the extern block. Called on the JS thread with a live env.
    unsafe {
        let _ = napi_adjust_external_memory(env, delta_bytes, &mut adjusted);
    }
}

const MIB: i64 = 1024 * 1024;

/// `Model` reports its real footprint: the loaded weights are approximately the size of the
/// `.aicmodel` file on disk (measured: tyto-l 19.8 MB file -> 19 MiB resident; quail 5.3 MB
/// -> 5 MiB). See `Model::from_file`. This fallback is only used if the file cannot be
/// stat'd, and is deliberately conservative (over-reporting is safe; under-reporting is what
/// caused the original OOM).
pub const MODEL_FALLBACK_BYTES: i64 = 64 * MIB;

// Estimates for the objects created *from* a model. Unlike the model itself, these are not
// reachable as real numbers here: the ~134 MB the Ruby binding measured for an analysis pair
// is allocated natively when the model's weights are expanded (and, for a Processor, partly
// at `initialize()` when the working buffers are sized). Until aic_sdk exposes a per-instance
// query (e.g. `aic_*_memory_usage()`, which the SDK team has been asked for), these are keyed
// to the largest common model so they over-report for smaller ones. Over-reporting only makes
// GC a little more eager; under-reporting is the dangerous direction.
pub const PROCESSOR_BYTES: i64 = 160 * MIB;
pub const ANALYZER_BYTES: i64 = 160 * MIB;
pub const COLLECTOR_BYTES: i64 = 16 * MIB;
pub const FILE_ANALYZER_BYTES: i64 = 176 * MIB;
