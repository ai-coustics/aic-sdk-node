use crate::{
  claim_sdk_id,
  error::{Result, disposed_error, map_err},
  mem,
  model::Model,
  processor::{OtelConfig, ProcessorContext, audio_config},
};

use napi::{
  Env, Task,
  bindgen_prelude::{AsyncTask, Float32Array, ObjectFinalize},
};
use napi_derive::napi;
use std::sync::{
  Arc, Mutex, MutexGuard,
  atomic::{AtomicI64, Ordering},
};

/// The SDK object shared between a binding class and the tasks it spawns.
///
/// A `Mutex` rather than an async lock: `compute` runs on a libuv worker, where blocking
/// is exactly what that thread is for.
pub(crate) type Shared<T> = Arc<Mutex<T>>;

/// Locks a shared SDK object, recovering the guard if the lock is poisoned.
///
/// Poisoning would mean an earlier call panicked mid-process, which the SDK does not do.
/// Recovering keeps one hypothetical failure from turning every later call into a panic.
pub(crate) fn lock<T>(shared: &Mutex<T>) -> MutexGuard<'_, T> {
  shared
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// An SDK object whose native lifetime several JS handles share, plus the external-memory
/// claims those handles have made against it.
///
/// `ProcessorAsync` and `VadAsync` can hand out second JS handles onto the same native
/// object (`withConfig`), and each handle reports the object's footprint at construction
/// and gives it back at finalization. The claims therefore live on the shared object, and
/// are drained exactly once: by `dispose()`, or by the last handle's finalizer, whichever
/// comes first. The ledger always balances.
pub(crate) struct Held<T> {
  inner: Mutex<Option<T>>,
  outstanding: AtomicI64,
}

impl<T> Held<T> {
  pub(crate) fn new(inner: T) -> Self {
    Self {
      inner: Mutex::new(Some(inner)),
      outstanding: AtomicI64::new(0),
    }
  }

  /// Records `bytes` of external memory claimed by a JS handle onto this object.
  pub(crate) fn claim(&self, bytes: i64) {
    self.outstanding.fetch_add(bytes, Ordering::SeqCst);
  }

  /// Gives back this handle's claim, if the claims are still outstanding. A no-op once
  /// `release()` drained the ledger.
  pub(crate) fn unclaim(&self, env: Env, bytes: i64) {
    let previous = self.outstanding.fetch_sub(bytes, Ordering::SeqCst);
    if previous >= bytes {
      mem::adjust(env, -bytes);
    } else {
      // Claims were already drained; undo the underflow so the ledger stays at zero.
      self.outstanding.fetch_add(bytes, Ordering::SeqCst);
    }
  }

  /// Destroys the native object, if it is still live, giving back every outstanding
  /// claim exactly once. Idempotent.
  ///
  /// Called by `dispose()`, which destroys the object regardless of other handles, and
  /// by the finalizer of the last surviving handle.
  pub(crate) fn release(&self, env: Env) {
    if lock(&self.inner).take().is_some() {
      mem::adjust(env, -self.outstanding.swap(0, Ordering::SeqCst));
    }
  }

  /// Whether the native object is still live.
  pub(crate) fn is_live(&self) -> bool {
    lock(&self.inner).is_some()
  }

  /// Runs `f` with the native object, or fails with the disposed error.
  pub(crate) fn with<R>(&self, class: &str, f: impl FnOnce(&mut T) -> Result<R>) -> Result<R> {
    let mut guard = lock(&self.inner);
    let inner = guard.as_mut().ok_or_else(|| disposed_error(class))?;
    f(inner)
  }
}

impl<T> Drop for Held<T> {
  fn drop(&mut self) {
    // Frees the native object when the last `Arc` handle goes away without any
    // finalizer having released it, e.g. the last JS handle was collected while a task
    // still held a clone. Freeing matters more than exact bookkeeping here: the
    // outstanding claim, if any, stays reported, which only makes V8 a little more
    // eager for the rest of the process.
    match self.inner.get_mut() {
      Ok(slot) => slot.take(),
      // Dropping cannot fail on a poisoned lock: the guard's contents are still ours.
      Err(poisoned) => poisoned.into_inner().take(),
    };
  }
}

/// Speech enhancement processor that keeps its work off the main thread.
///
/// The same processing as {@link Processor}, but each call returns a promise and runs on
/// Node's libuv thread pool, so the event loop stays responsive. Prefer this when other
/// work shares that loop, as in a server; prefer {@link Processor} on a dedicated audio
/// thread or in a batch script, where nothing else needs the loop.
///
/// Mirrors `ProcessorAsync` in the Rust SDK.
///
/// ### Concurrency
///
/// One instance handles one stream. Do not start a second {@link ProcessorAsync#process}
/// before the first resolves: libuv completes work items out of order, which would
/// desync the stream. To process several streams at once, create several instances.
///
/// The libuv pool is four threads by default and is shared with `fs`, `dns` and `crypto`.
/// Raise `UV_THREADPOOL_SIZE` before Node starts to run more streams in parallel. The
/// SDK's own `AIC_NUM_THREADS` does not apply here: that variable sizes a rayon pool this
/// binding deliberately does not use.
#[napi(custom_finalize)]
pub struct ProcessorAsync {
  inner: Arc<Held<aic_sdk::Processor<'static>>>,
}

impl ObjectFinalize for ProcessorAsync {
  fn finalize(self, env: Env) -> Result<()> {
    if Arc::strong_count(&self.inner) == 1 {
      // Last handle onto the native object: destroy it and drain every claim.
      self.inner.release(env);
    } else {
      // Other handles (or in-flight tasks) keep the object alive; only this handle's
      // claim goes back.
      self.inner.unclaim(env, mem::PROCESSOR_BYTES);
    }
    Ok(())
  }
}

#[napi]
impl ProcessorAsync {
  /// Creates a processor from an enhancement or bypass model.
  ///
  /// Construction is synchronous and throws on failure, as in the Rust SDK; only the
  /// audio work is deferred to a worker thread.
  ///
  /// Telemetry follows the runtime environment; pass `otelConfig` to override it for this
  /// instance.
  #[napi(constructor)]
  pub fn new(
    env: Env,
    model: &Model,
    license_key: String,
    otel_config: Option<OtelConfig>,
  ) -> Result<Self> {
    let model_inner = model.live()?;
    claim_sdk_id();
    let inner = match otel_config {
      Some(config) => {
        aic_sdk::Processor::with_otel_config(model_inner, &license_key, &config.into())
      }
      None => aic_sdk::Processor::new(model_inner, &license_key),
    };
    let inner = Arc::new(Held::new(map_err(inner)?));
    inner.claim(mem::PROCESSOR_BYTES);
    mem::adjust(env, mem::PROCESSOR_BYTES);

    Ok(Self { inner })
  }

  /// Destroys the native processor immediately, releasing its memory and telemetry
  /// session without waiting for garbage collection.
  ///
  /// Every later method throws; calling `dispose()` again does nothing. Blocks until
  /// in-flight work on the libuv pool finishes.
  #[napi]
  pub fn dispose(&self, env: Env) {
    self.inner.release(env);
  }

  /// Initializes the processor and resolves to a handle onto it, for chaining off the
  /// constructor:
  ///
  /// ```js
  /// const processor = await new ProcessorAsync(model, licenseKey).withConfig(48000, 480)
  /// ```
  ///
  /// The handle it resolves to drives the same underlying processor as the receiver, so
  /// either one can be used afterwards. Rust returns `self` here, which JS cannot express.
  #[napi(ts_return_type = "Promise<ProcessorAsync>")]
  pub fn with_config(
    &self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> AsyncTask<ProcessorWithConfigTask> {
    AsyncTask::new(ProcessorWithConfigTask {
      inner: self.inner.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Configures the processor for an audio format. Must be called before processing.
  ///
  /// See {@link Processor#initialize}. Allocates, which is why it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn initialize(
    &self,
    sample_rate: u32,
    block_size: u32,
    variable_block_size: Option<bool>,
  ) -> AsyncTask<ProcessorInitializeTask> {
    AsyncTask::new(ProcessorInitializeTask {
      inner: self.inner.clone(),
      config: audio_config(sample_rate, block_size, variable_block_size),
    })
  }

  /// Enhances a mono audio block and resolves to the enhanced samples.
  ///
  /// Unlike {@link Processor#process} this does **not** write into the caller's array.
  /// The samples are copied out before the work is queued, so the input stays valid and
  /// untouched no matter what the caller does while the promise is pending, and the
  /// result arrives as a new array:
  ///
  /// ```js
  /// let audio = new Float32Array(blockSize)
  /// for (;;) audio = await processor.process(audio)
  /// ```
  ///
  /// The block must be exactly `blockSize` samples, or at most `blockSize` if
  /// `variableBlockSize` was enabled.
  // Spelled out as `Float32Array<ArrayBuffer>` rather than a bare `Float32Array`, which
  // TypeScript widens to `Float32Array<ArrayBufferLike>`, which would not assign back to
  // a `let audio = new Float32Array(n)`, breaking the reuse loop above. The buffer handed
  // to V8 is always a plain ArrayBuffer, never shared, so the narrower type is accurate.
  #[napi(ts_return_type = "Promise<Float32Array<ArrayBuffer>>")]
  pub fn process(&self, audio: Float32Array) -> AsyncTask<ProcessorProcessTask> {
    AsyncTask::new(ProcessorProcessTask {
      inner: self.inner.clone(),
      // Copied on the JS thread so the worker owns its samples outright. A block is a
      // couple of kilobytes, far below the cost of running the model over it, and it
      // removes any chance of JS mutating the buffer mid-process.
      audio: audio.to_vec(),
    })
  }

  /// Creates a handle for reading and writing this processor's parameters and state.
  ///
  /// Asynchronous because it takes the processor lock, which a queued `process` may
  /// briefly hold; awaiting keeps that wait off the event loop. The returned handle is
  /// the same {@link ProcessorContext} the synchronous class hands out, and every one of
  /// its methods is synchronous.
  #[napi(ts_return_type = "Promise<ProcessorContext>")]
  pub fn get_context(&self) -> AsyncTask<ProcessorContextTask> {
    AsyncTask::new(ProcessorContextTask {
      inner: self.inner.clone(),
    })
  }

  /// Ends this processor's telemetry session, after which it can no longer process audio.
  ///
  /// May block, which is why it runs on a worker.
  #[napi(ts_return_type = "Promise<void>")]
  pub fn terminate_session(&self) -> AsyncTask<ProcessorTerminateTask> {
    AsyncTask::new(ProcessorTerminateTask {
      inner: self.inner.clone(),
    })
  }
}

/// Backs {@link ProcessorAsync#withConfig}.
pub struct ProcessorWithConfigTask {
  inner: Arc<Held<aic_sdk::Processor<'static>>>,
  config: aic_sdk::ProcessorConfig,
}

impl Task for ProcessorWithConfigTask {
  type Output = ();
  type JsValue = ProcessorAsync;

  fn compute(&mut self) -> Result<()> {
    self.inner.with("ProcessorAsync", |inner| {
      map_err(inner.initialize(&self.config))
    })
  }

  fn resolve(&mut self, env: Env, _: ()) -> Result<ProcessorAsync> {
    // A second JS instance wrapping the same processor: it reports the same footprint at
    // finalize, so it must claim it here to keep the external-memory ledger balanced.
    // Born disposed when the processor was disposed mid-flight, in which case there is
    // nothing to claim.
    if self.inner.is_live() {
      self.inner.claim(mem::PROCESSOR_BYTES);
      mem::adjust(env, mem::PROCESSOR_BYTES);
    }

    Ok(ProcessorAsync {
      inner: self.inner.clone(),
    })
  }
}

/// Backs {@link ProcessorAsync#initialize}.
pub struct ProcessorInitializeTask {
  inner: Arc<Held<aic_sdk::Processor<'static>>>,
  config: aic_sdk::ProcessorConfig,
}

impl Task for ProcessorInitializeTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    self.inner.with("ProcessorAsync", |inner| {
      map_err(inner.initialize(&self.config))
    })
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
    Ok(())
  }
}

/// Backs {@link ProcessorAsync#process}.
pub struct ProcessorProcessTask {
  inner: Arc<Held<aic_sdk::Processor<'static>>>,
  audio: Vec<f32>,
}

impl Task for ProcessorProcessTask {
  type Output = Vec<f32>;
  type JsValue = Float32Array;

  fn compute(&mut self) -> Result<Vec<f32>> {
    // Moved out rather than borrowed so the buffer can be handed to V8 in `resolve`
    // without another copy. The task is used once, so leaving an empty Vec behind is fine.
    let mut audio = std::mem::take(&mut self.audio);
    self
      .inner
      .with("ProcessorAsync", |inner| map_err(inner.process(&mut audio)))?;

    Ok(audio)
  }

  fn resolve(&mut self, _env: Env, audio: Vec<f32>) -> Result<Float32Array> {
    // Hands the allocation to V8 as an external ArrayBuffer, so the enhanced samples
    // are not copied again on the way out.
    Ok(Float32Array::new(audio))
  }
}

/// Backs {@link ProcessorAsync#getContext}.
pub struct ProcessorContextTask {
  inner: Arc<Held<aic_sdk::Processor<'static>>>,
}

impl Task for ProcessorContextTask {
  type Output = aic_sdk::ProcessorContext;
  type JsValue = ProcessorContext;

  fn compute(&mut self) -> Result<aic_sdk::ProcessorContext> {
    self
      .inner
      .with("ProcessorAsync", |inner| Ok(inner.context()))
  }

  fn resolve(&mut self, _env: Env, context: aic_sdk::ProcessorContext) -> Result<ProcessorContext> {
    Ok(ProcessorContext { inner: context })
  }
}

/// Backs {@link ProcessorAsync#terminateSession}.
pub struct ProcessorTerminateTask {
  inner: Arc<Held<aic_sdk::Processor<'static>>>,
}

impl Task for ProcessorTerminateTask {
  type Output = ();
  type JsValue = ();

  fn compute(&mut self) -> Result<()> {
    self
      .inner
      .with("ProcessorAsync", |inner| map_err(inner.terminate_session()))
  }

  fn resolve(&mut self, _env: Env, _: ()) -> Result<()> {
    Ok(())
  }
}
