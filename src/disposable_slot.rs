//! One native SDK object, destroyed exactly once, with its footprint reported to V8 for
//! as long as it lives.
//!
//! Every binding class holds its SDK object in a slot, so the disposed error and the
//! footprint accounting are written once here rather than per class. The slot itself is
//! a plain owner with no interior mutability; the classes that share their object with
//! tasks on the libuv pool wrap it in an `Arc<Mutex<_>>` and reach it through [`lock`].

use std::sync::{Mutex, MutexGuard};

use napi::Env;

use crate::{
  error::{Result, disposed_error},
  mem::adjust,
};

/// A slot holding a native SDK object until it is disposed, after which every access
/// fails with the disposed error.
///
/// The slot owns both halves of the object's footprint report: [`new`](Self::new) reports
/// it to V8 and [`release`](Self::release) gives it back. `Option::take` makes the
/// give-back idempotent, so `dispose()` and a class finalizer cannot double-count it.
///
/// A slot dropped without `release` having run still destroys the object, but those
/// bytes stay reported: giving them back takes an `Env`, which a `Drop` impl does not
/// have. That happens when the last JS handle onto a shared object is finalized while a
/// task still holds a clone; over-reporting only makes V8 a little more eager for the
/// rest of the process.
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

  /// The same, for a `&mut` call.
  pub(crate) fn get_mut(&mut self) -> Result<&mut T> {
    self
      .inner
      .as_mut()
      .ok_or_else(|| disposed_error(self.class))
  }

  /// Destroys the native object, if it is still live, and gives its footprint back to
  /// V8. Idempotent.
  ///
  /// Called by `dispose()` and by the class finalizer, in whichever order they happen.
  pub(crate) fn release(&mut self, env: Env) {
    if self.inner.take().is_some() {
      adjust(env, -self.bytes);
    }
  }
}

/// Locks a shared slot, recovering the guard if the lock is poisoned.
///
/// A `Mutex` rather than an async lock: `compute` runs on a libuv worker, where blocking
/// is exactly what that thread is for.
///
/// Poisoning would mean an earlier call panicked while holding the guard, which the SDK
/// does not do. Recovering keeps one hypothetical failure from turning every later call
/// into a panic, disposal included: a panic would happen inside an SDK call, leaving the
/// slot's own `Option` intact.
pub(crate) fn lock<T>(slot: &Mutex<T>) -> MutexGuard<'_, T> {
  slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}
