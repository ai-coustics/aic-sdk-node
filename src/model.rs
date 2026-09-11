use crate::{
  disposable_slot::DisposableSlot,
  error::{JsAicError, Result, map_err},
  mem,
};

use napi::{Env, Task, bindgen_prelude::AsyncTask, bindgen_prelude::ObjectFinalize};
use napi_derive::napi;

/// A loaded ai-coustics model.
///
/// The same model can be used to create multiple independent instances of a compatible
/// processor, VAD or analyzer. Each instance retains a reference to the model data,
/// so the `Model` handle can be disposed or garbage collected first.
#[napi(custom_finalize)]
pub struct Model {
  // The memory-mapped model owns its data and has a `'static` lifetime.
  // Report the file size as this instance's native memory estimate.
  slot: DisposableSlot<aic_sdk::Model<'static>>,
}

impl ObjectFinalize for Model {
  fn finalize(mut self, env: Env) -> Result<()> {
    // A no-op if `dispose()` already ran.
    self.slot.release(env);
    Ok(())
  }
}

impl Model {
  /// The inner SDK model, or the disposed error once `dispose()` ran.
  pub(crate) fn inner(&self) -> Result<&aic_sdk::Model<'static>> {
    self.slot.get()
  }
}

#[napi]
impl Model {
  /// Loads a model from a `.aicmodel` file.
  ///
  /// The SDK memory-maps the file. Do not modify or delete it while the model or any
  /// processor, VAD or analyzer created from it is still alive.
  ///
  /// Download models with {@link Model.download}. Available model IDs are listed at
  /// <https://artifacts.ai-coustics.io>.
  ///
  /// @param path - Path to the model file.
  /// @throws If the file cannot be loaded or its format is incompatible with this SDK.
  #[napi(factory)]
  pub fn from_file(env: Env, path: String) -> Result<Self> {
    // Prevent path traversal attacks by rejecting paths containing '..'.
    let path_ref = std::path::Path::new(&path);
    if path_ref.components().any(|c| c == std::path::Component::ParentDir) {
      return Err(map_err(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        format!("Invalid input: {}", path_ref.display())
      )));
    }
    let inner = map_err(aic_sdk::Model::from_file(&path))?;
    let bytes = mem::model_bytes(path_ref);

    Ok(Self {
      slot: DisposableSlot::new(env, inner, "Model", bytes),
    })
  }

  /// Releases this handle's reference to the native model without waiting for garbage collection.
  ///
  /// Instances created from this model remain usable. The file mapping is released when
  /// its last reference is destroyed.
  ///
  /// After disposal, all methods except `dispose()` throw. Repeated disposal has no effect.
  #[napi]
  pub fn dispose(&mut self, env: Env) {
    self.slot.release(env);
  }

  /// Downloads a model from the ai-coustics CDN and returns a promise for its file path.
  ///
  /// Each call fetches the manifest to select the latest compatible model version.
  /// An existing file is reused if its checksum matches; otherwise it is replaced.
  /// The download runs on Node's libuv thread pool.
  ///
  /// @param modelId - Model ID listed at <https://artifacts.ai-coustics.io>.
  /// @param downloadDir - Directory in which to store the model.
  /// @returns A promise for the downloaded or cached model's path.
  // napi cannot infer an `AsyncTask`'s resolved type; without the annotation the
  // generated d.ts says `Promise<unknown>`.
  #[napi(ts_return_type = "Promise<string>")]
  pub fn download(model_id: String, download_dir: String) -> AsyncTask<DownloadTask> {
    AsyncTask::new(DownloadTask {
      model_id,
      download_dir,
    })
  }

  /// Returns the model identifier, including its build and format version suffixes.
  #[napi]
  pub fn get_id(&self) -> Result<String> {
    Ok(self.inner()?.id().to_owned())
  }

  /// Returns the sample rate in Hz for which the model was trained.
  ///
  /// The SDK resamples audio at other supported rates internally. Enhancement is limited
  /// to frequencies below half the model's sample rate.
  #[napi]
  pub fn get_optimal_sample_rate(&self) -> Result<u32> {
    Ok(self.inner()?.optimal_sample_rate())
  }

  /// Returns the optimal block size in samples for the given sample rate.
  ///
  /// Use this value to avoid additional buffering latency. The block size depends on the
  /// sample rate because each model processes a fixed duration of audio.
  ///
  /// @param sampleRate - Audio sample rate in Hz.
  #[napi]
  pub fn get_optimal_block_size(&self, sample_rate: u32) -> Result<u32> {
    // Use `u32` so block sizes are exposed as JavaScript numbers for typed-array lengths.
    Ok(self.inner()?.optimal_block_size(sample_rate) as u32)
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
