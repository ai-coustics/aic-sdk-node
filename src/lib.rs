#![deny(clippy::all)]

//! Node.js bindings for the ai-coustics Audio Intelligence SDK.
//!
//! Thin napi-rs layer over the `aic-sdk` crate: the classes here own the corresponding SDK
//! types directly, so lifetimes, cleanup and thread-safety are handled upstream.

use napi_derive::napi;

mod analyzer;
mod error;
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

/// Telemetry id assigned to this binding. Must match `SdkWrapper::NodeJs` in
/// `aic-sdk-telemetry`.
const SDK_WRAPPER_ID_NODE: u32 = 4;

/// Claims the Node telemetry id, unless a wrapper embedding this package claimed its own
/// first via [`set_sdk_id`].
///
/// The id lives in a `OnceLock` upstream: the first write wins and every later write is
/// silently discarded. `aic-sdk` sets `2` ("Rust") inside each of its `Processor`, `Vad`
/// and analyzer constructors, so every constructor here claims `4` before delegating. It is
/// not claimed at module load on purpose: an embedder can only call [`set_sdk_id`] once the
/// module is loaded, and their write must be able to win, so the window between load and
/// first construction has to stay open.
pub(crate) fn claim_sdk_id() {
  // SAFETY: `4` is the wrapper id assigned to this binding by ai-coustics.
  unsafe { aic_sdk::set_sdk_id(SDK_WRAPPER_ID_NODE) };
}

/// Overrides the telemetry wrapper id. Internal only, for ai-coustics wrappers embedding
/// this package (e.g. the LiveKit plugin): call before constructing any `Processor`, `Vad`
/// or `Analyzer`, whose constructors otherwise claim the id for this SDK. The id can only
/// be set once per process; later writes are silently discarded.
#[napi(js_name = "_setSdkId")]
pub fn set_sdk_id(id: u32) {
  // SAFETY: This function has no safety requirements.
  unsafe { aic_sdk::set_sdk_id(id) };
}

/// The version of the underlying native SDK, e.g. `"0.23.0"`.
///
/// Not necessarily this package's version.
#[napi]
pub fn get_version() -> String {
  aic_sdk::get_sdk_version().to_owned()
}

/// The model file format version this SDK can load.
///
/// Model URLs are versioned by this number, so it decides which model files are usable.
#[napi]
pub fn get_compatible_model_version() -> u32 {
  aic_sdk::get_compatible_model_version()
}
