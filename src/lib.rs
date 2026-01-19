use neon::prelude::*;

mod model;
mod processor;
mod processor_context;
mod vad_context;

fn get_sdk_version(mut cx: FunctionContext) -> JsResult<JsString> {
    let version = aic_sdk::get_sdk_version();
    Ok(cx.string(version))
}

fn get_compatible_model_version(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let model_version = aic_sdk::get_compatible_model_version();
    Ok(cx.number(model_version))
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    // Free functions
    cx.export_function("getVersion", get_sdk_version)?;
    cx.export_function("getCompatibleModelVersion", get_compatible_model_version)?;

    // Model
    model::register_exports(&mut cx)?;

    // Processor
    processor::register_exports(&mut cx)?;

    // ProcessorContext
    processor_context::register_exports(&mut cx)?;

    // VadContext
    vad_context::register_exports(&mut cx)?;

    Ok(())
}
