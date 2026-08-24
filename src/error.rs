use aic_sdk::AicError;

/// Newtype so the SDK's error can be converted into a JS exception.
///
/// `AicError` and `napi::Error` are both foreign to this crate, so the
/// conversion needs a local type to hang the impl on.
pub struct JsAicError(pub AicError);

impl From<AicError> for JsAicError {
  fn from(error: AicError) -> Self {
    Self(error)
  }
}

impl From<JsAicError> for napi::Error {
  fn from(error: JsAicError) -> Self {
    // `AicError`'s `Display` messages are user-facing and already explain how to
    // recover (see `aic-sdk`'s error.rs), so they are surfaced verbatim.
    //
    // Every variant maps to a plain `Error`. Throwing `RangeError` for
    // `ParameterOutOfRange`, as the wasm binding does, would require a distinct
    // return type per method in napi-rs for little gain: the message already
    // names the problem.
    napi::Error::new(napi::Status::GenericFailure, error.0.to_string())
  }
}

/// Shorthand for the `Result` every binding method returns.
pub type Result<T> = napi::Result<T>;

/// Converts an SDK result into a JS-throwing result.
pub fn map_err<T>(result: std::result::Result<T, AicError>) -> Result<T> {
  result.map_err(|error| JsAicError(error).into())
}
