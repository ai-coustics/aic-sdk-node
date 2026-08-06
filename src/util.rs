use neon::{
    handle::Handle,
    object::Object,
    prelude::FunctionContext,
    result::NeonResult,
    types::{JsBoolean, JsNull, JsNumber, JsObject, JsString, JsUndefined, JsValue},
};

/// Reads a [`aic_sdk::ProcessorConfig`] from three consecutive arguments
/// (`sampleRate`, `blockSize`, `variableBlockSize`) starting at `first_arg`.
pub fn parse_processor_config(
    cx: &mut FunctionContext,
    first_arg: usize,
) -> NeonResult<aic_sdk::ProcessorConfig> {
    let sample_rate = cx.argument::<JsNumber>(first_arg)?.value(cx) as u32;
    let block_size = cx.argument::<JsNumber>(first_arg + 1)?.value(cx) as usize;
    let variable_block_size = cx.argument::<JsBoolean>(first_arg + 2)?.value(cx);

    Ok(aic_sdk::ProcessorConfig {
        sample_rate,
        block_size,
        variable_block_size,
    })
}

/// Reads an optional [`aic_sdk::OtelConfig`] from a JS value.
///
/// `null` and `undefined` map to `None`, which leaves the SDK's environment-based
/// telemetry defaults in place.
pub fn parse_otel_config(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
) -> NeonResult<Option<aic_sdk::OtelConfig>> {
    if is_nullish(cx, value) {
        return Ok(None);
    }

    let object = value.downcast_or_throw::<JsObject, _>(cx)?;
    let enable = object.get::<JsBoolean, _, _>(cx, "enable")?.value(cx);

    let session_id_value = object.get::<JsValue, _, _>(cx, "sessionId")?;
    let session_id = if is_nullish(cx, session_id_value) {
        None
    } else {
        Some(
            session_id_value
                .downcast_or_throw::<JsString, _>(cx)?
                .value(cx),
        )
    };

    let export_interval_value = object.get::<JsValue, _, _>(cx, "exportIntervalMs")?;
    let export_interval_ms = if is_nullish(cx, export_interval_value) {
        0
    } else {
        export_interval_value
            .downcast_or_throw::<JsNumber, _>(cx)?
            .value(cx) as u32
    };

    Ok(Some(aic_sdk::OtelConfig {
        enable,
        session_id,
        export_interval_ms,
    }))
}

/// Returns `true` if the value is `null` or `undefined`.
fn is_nullish(cx: &mut FunctionContext, value: Handle<JsValue>) -> bool {
    value.is_a::<JsUndefined, _>(cx) || value.is_a::<JsNull, _>(cx)
}
