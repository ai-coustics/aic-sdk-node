use aic_sdk::AicError;

/// Local wrapper for converting an SDK error into a JavaScript exception.
///
/// Rust's orphan rules require a local type because both `AicError` and `napi::Error`
/// are defined in dependencies.
pub struct JsAicError(pub AicError);

impl From<AicError> for JsAicError {
  fn from(error: AicError) -> Self {
    Self(error)
  }
}

impl From<JsAicError> for napi::Error {
  fn from(error: JsAicError) -> Self {
    // Preserve the SDK's error message. All SDK errors become plain JavaScript Errors.
    napi::Error::new(napi::Status::GenericFailure, error.0.to_string())
  }
}

/// Shorthand for the `Result` every binding method returns.
pub type Result<T> = napi::Result<T>;

/// Converts an SDK result into a JS-throwing result.
pub fn map_err<T>(result: std::result::Result<T, AicError>) -> Result<T> {
  result.map_err(|error| JsAicError(error).into())
}

/// The error thrown by any method called after `dispose()`.
pub fn disposed_error(class: &str) -> napi::Error {
  napi::Error::new(
    napi::Status::GenericFailure,
    format!("{class} has been disposed"),
  )
}
