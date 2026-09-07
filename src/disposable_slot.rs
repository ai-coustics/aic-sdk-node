//! Owns a native SDK object and tracks its estimated memory usage in V8.
//!
//! All binding classes use this slot for disposal checks and memory reporting.
//! Classes shared with libuv tasks wrap it in `Arc<Mutex<_>>`.

use std::sync::{Mutex, MutexGuard};

use napi::Env;

use crate::{
  error::{Result, disposed_error},
  mem::adjust,
};

/// A slot holding a native SDK object until it is disposed, after which every access
/// fails with the disposed error.
///
/// [`new`](Self::new) reports the object's footprint to V8 and [`release`](Self::release)
/// withdraws it. `Option::take` makes `release` idempotent, so `dispose()` and a class
/// finalizer cannot withdraw it twice.
///
/// A slot dropped without `release` having run still destroys the object, but its bytes
/// stay reported: withdrawing them needs an `Env`, which `Drop` does not have. This
/// happens when the last JS handle onto a shared object is finalized while a task still
/// holds a clone, and leaves V8 over-reported for the rest of the process.
pub(crate) struct DisposableSlot<T> {
  inner: Option<T>,
  /// The JS class name, for the disposed error message.
  class: &'static str,
  /// The footprint reported to V8 while `inner` is live.
  bytes: i64,
}

impl<T> DisposableSlot<T> {
  /// Takes ownership of `inner` and reports its `bytes` of native footprint to V8.
  pub(crate) fn new(env: Env, inner: T, class: &'static str, bytes: i64) -> Self {
    adjust(env, bytes);

    Self {
      inner: Some(inner),
      class,
      bytes,
    }
  }

  /// The native object, or the disposed error once it is gone.
  pub(crate) fn get(&self) -> Result<&T> {
    self
      .inner
      .as_ref()
      .ok_or_else(|| disposed_error(self.class))
  }

  /// The native object as `&mut`, or the disposed error once it is gone.
  pub(crate) fn get_mut(&mut self) -> Result<&mut T> {
    self
      .inner
      .as_mut()
      .ok_or_else(|| disposed_error(self.class))
  }

  /// Destroys the native object, if it is still live, and withdraws its footprint report.
  /// Idempotent, since `dispose()` and the class finalizer both call it.
  pub(crate) fn release(&mut self, env: Env) {
    if self.inner.take().is_some() {
      adjust(env, -self.bytes);
    }
  }
}

/// Locks a shared slot, recovering the guard if the mutex is poisoned.
///
/// Recovery allows disposal after a task panics. The slot's `Option` still records
/// whether the native object has been released.
pub(crate) fn lock<T>(slot: &Mutex<T>) -> MutexGuard<'_, T> {
  slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
