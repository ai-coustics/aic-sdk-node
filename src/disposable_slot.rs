//! One native SDK object shared by several JS handles, destroyed exactly once.
//!
//! `ProcessorAsync` and `VadAsync` are the only classes that need this: `withConfig` hands
//! out a second JS handle onto the same native object, and each in-flight task on the
//! libuv pool holds an `Arc` clone. Whichever owner gets there first destroys the object
//! and gives its footprint back to V8; the rest find it already gone. The sync classes own
//! their object outright and use a plain `Option` field instead.

use std::sync::Mutex;

use napi::Env;

use crate::{
  error::{Result, disposed_error},
  mem::adjust,
  processor_async::lock,
};

/// A slot holding a native SDK object with several owners, emptied by whichever one gets
/// there first. Every later access finds it empty and fails with the disposed error.
///
/// Its footprint is reported to V8 once per object, at construction, and given back
/// exactly once: by `dispose()`, or by the finalizer of the last surviving handle.
/// `Option::take` makes the give-back idempotent, so the two never double-count.
pub(crate) struct DisposableSlot<T> {
  inner: Mutex<Option<T>>,
}

impl<T> DisposableSlot<T> {
  pub(crate) fn new(inner: T) -> Self {
    Self {
      inner: Mutex::new(Some(inner)),
    }
  }

  /// Destroys the native object, if it is still live, and gives its footprint back to
  /// V8. Idempotent.
  ///
  /// Called by `dispose()`, which destroys the object regardless of other handles, and
  /// by the finalizer of the last surviving handle.
  pub(crate) fn release(&self, env: Env, bytes: i64) {
    if lock(&self.inner).take().is_some() {
      adjust(env, -bytes);
    }
  }

  /// Runs `f` with the native object, or fails with the disposed error.
  pub(crate) fn with<R>(&self, class: &str, f: impl FnOnce(&mut T) -> Result<R>) -> Result<R> {
    let mut guard = lock(&self.inner);
    let inner = guard.as_mut().ok_or_else(|| disposed_error(class))?;
    f(inner)
  }
}

impl<T> Drop for DisposableSlot<T> {
  fn drop(&mut self) {
    // Frees the native object when the last `Arc` goes away without `release` having
    // run, e.g. the last JS handle was finalized while a task still held a clone (that
    // finalizer saw the extra reference and left the object for the task). The footprint
    // report cannot be returned here, since that takes the finalizer's `Env`, so those
    // bytes stay reported, which only makes V8 a little more eager for the rest of the
    // process.
    match self.inner.get_mut() {
      Ok(slot) => slot.take(),
      // Dropping cannot fail on a poisoned lock: the guard's contents are still ours.
      Err(poisoned) => poisoned.into_inner().take(),
    };
  }
}
