use crate::{
  error::{JsAicError, Result, disposed_error, map_err},
  mem,
};

use napi::{Env, Task, bindgen_prelude::AsyncTask, bindgen_prelude::ObjectFinalize};
use napi_derive::napi;

/// A loaded ai-coustics model.
///
/// One model can back multiple processors, VADs and analyzers, according to its type.
/// The underlying model data is kept alive by every object created from it through
/// internal reference counting, so this handle may be released first.
#[napi(custom_finalize)]
pub struct Model {
  // `from_file` memory-maps the file rather than borrowing a caller-owned buffer, so
  // the SDK model is `'static` and needs no lifetime plumbing here.
  pub(crate) inner: Option<aic_sdk::Model<'static>>,
  /// Native footprint reported to V8's GC while this instance is alive (the mmap'd
  /// weights). Reported back on dispose or finalize so the accounting balances.
  reported_bytes: i64,
}

impl ObjectFinalize for Model {
  fn finalize(self, env: Env) -> Result<()> {
    // `dispose()` already gave the footprint back when the inner is gone.
    if self.inner.is_some() {
      mem::adjust(env, -self.reported_bytes);
    }
    Ok(())
  }
}

impl Model {
  /// The SDK model, or the disposed error once `dispose()` ran.
  pub(crate) fn sdk(&self) -> std::result::Result<&aic_sdk::Model<'static>, napi::Error> {
    self.inner.as_ref().ok_or_else(|| disposed_error("Model"))
  }
}

#[napi]
impl Model {
  /// Loads a model from a `.aicmodel` file.
  ///
  /// The model data is memory-mapped, not copied into the process, so the file must
  /// not be modified or deleted while this model, or any object created from it,
  /// is alive.
  ///
  /// Browse available models at <https://artifacts.ai-coustics.io>, or fetch one with
  /// {@link Model.download}.
  #[napi(factory)]
  pub fn from_file(env: Env, path: String) -> Result<Self> {
    let inner = map_err(aic_sdk::Model::from_file(&path))?;
    let reported_bytes = mem::model_bytes(std::path::Path::new(&path));
    mem::adjust(env, reported_bytes);

    Ok(Self {
      inner: Some(inner),
      reported_bytes,
    })
  }

  /// Unmaps the model file immediately, releasing its footprint without waiting for
  /// garbage collection.
  ///
  /// Objects already created from the model keep working: the SDK keeps the weights
  /// alive through internal reference counting. Every later method on this handle
  /// throws; calling `dispose()` again does nothing.
  #[napi]
  pub fn dispose(&mut self, env: Env) {
    if self.inner.take().is_some() {
      mem::adjust(env, -self.reported_bytes);
    }
  }

  /// Downloads a model from the ai-coustics artifact CDN and resolves to its path.
  ///
  /// The manifest is re-fetched on every call so the newest compatible model version
  /// is always used. An existing file with a matching checksum is not re-downloaded;
  /// one with a mismatching checksum is replaced.
  ///
  /// The download runs on a worker thread, so it does not block the event loop.
  // napi cannot infer an `AsyncTask`'s resolved type, so it is declared explicitly;
  // without this the generated d.ts says `Promise<unknown>`.
  #[napi(ts_return_type = "Promise<string>")]
  pub fn download(model_id: String, download_dir: String) -> AsyncTask<DownloadTask> {
    AsyncTask::new(DownloadTask {
      model_id,
      download_dir,
    })
  }

  /// The model identifier, e.g. `quail-vf-2.2-s-16khz`.
  #[napi]
  pub fn get_id(&self) -> Result<String> {
    let inner = self.inner.as_ref().ok_or_else(|| disposed_error("Model"))?;
    Ok(inner.id().to_owned())
  }

  /// The sample rate in Hz the model was trained for.
  ///
  /// Audio at any rate can be processed, but a model only enhances frequencies up to
  /// its own Nyquist limit, so matching this rate gives the best quality.
  #[napi]
  pub fn get_optimal_sample_rate(&self) -> Result<u32> {
    let inner = self.inner.as_ref().ok_or_else(|| disposed_error("Model"))?;
    Ok(inner.optimal_sample_rate())
  }

  /// The block size that avoids internal buffering at `sampleRate`.
  ///
  /// Any other block size adds buffering latency on top of the base processing delay.
  /// The value changes with the sample rate, because the model works on a fixed time
  /// window: a 10 ms window is 480 samples at 48 kHz but 160 at 16 kHz.
  #[napi]
  pub fn get_optimal_block_size(&self, sample_rate: u32) -> Result<u32> {
    let inner = self.inner.as_ref().ok_or_else(|| disposed_error("Model"))?;
    // The SDK reports sizes as `usize`, which napi would marshal as a JS BigInt.
    // A BigInt block size would throw on `new Float32Array(n)` and on arithmetic
    // against plain numbers, so it crosses the boundary as u32. Block sizes are a
    // few thousand samples at most.
    Ok(inner.optimal_block_size(sample_rate) as u32)
  }
}

/// Runs the blocking model download on the libuv thread pool.
pub struct DownloadTask {
  model_id: String,
  download_dir: String,
}

impl Task for DownloadTask {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    let path = aic_sdk::Model::download(&self.model_id, &self.download_dir)
      .map_err(|error| napi::Error::from(JsAicError(error)))?;

    Ok(path.to_string_lossy().into_owned())
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output)
  }
}
