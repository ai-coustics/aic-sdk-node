#![deny(clippy::all)]

//! Node.js bindings for the ai-coustics SDK.
//!
//! The napi-rs classes wrap the Rust SDK's model, processing, VAD and analysis types.
//! Native objects are released through explicit disposal or JavaScript finalization.

use napi_derive::napi;

mod analyzer;
mod disposable_slot;
mod error;
mod mem;
mod model;
mod processor;
mod processor_async;
mod vad;
mod vad_async;

pub use analyzer::*;
pub use model::*;
pub use processor::*;
pub use processor_async::*;
pub use vad::*;
pub use vad_async::*;

/// Telemetry ID assigned to this binding. Must match `SdkWrapper::NodeJs` in
/// `aic-sdk-telemetry`.
const SDK_WRAPPER_ID_NODE: u32 = 4;

/// Sets the Node telemetry ID unless an embedding wrapper has already set one.
///
/// The upstream `OnceLock` accepts only the first write. Call this before delegating to
/// an SDK constructor, which would otherwise set the Rust wrapper ID (2).
/// Delaying this until construction lets embedders call [`set_sdk_id`] after module load.
pub(crate) fn claim_sdk_id() {
  // SAFETY: `4` is the wrapper ID assigned to this binding by ai-coustics.
  unsafe { aic_sdk::set_sdk_id(SDK_WRAPPER_ID_NODE) };
}

/// Overrides the telemetry wrapper ID. Internal only, for ai-coustics wrappers embedding
/// this package (e.g. the LiveKit plugin): call before constructing any `Processor`, `Vad`
/// or `Analyzer`, whose constructors otherwise claim the ID for this SDK. The ID can only
/// be set once per process; later writes are silently discarded.
#[napi(js_name = "_setSdkId")]
pub fn set_sdk_id(id: u32) {
  // SAFETY: This function has no safety requirements.
  unsafe { aic_sdk::set_sdk_id(id) };
}

/// Returns the version of the underlying native SDK.
///
/// This may differ from the Node.js package version.
#[napi]
pub fn get_version() -> String {
  aic_sdk::get_sdk_version().to_owned()
}

/// Returns the model file format version supported by this SDK.
#[napi]
pub fn get_compatible_model_version() -> u32 {
  aic_sdk::get_compatible_model_version()
}
