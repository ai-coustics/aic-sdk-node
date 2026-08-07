use neon::prelude::*;

mod analyzer;
mod model;
mod processor;
mod processor_context;
mod util;
mod vad;
mod vad_context;

fn get_sdk_version(mut cx: FunctionContext) -> JsResult<JsString> {
    let version = aic_sdk::get_sdk_version();
    Ok(cx.string(version))
}

fn get_compatible_model_version(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let model_version = aic_sdk::get_compatible_model_version();
    Ok(cx.number(model_version))
}

// Internal only, not part of the public API. Used by ai-coustics to identify wrapper
// SDKs/plugins that embed this package (e.g. a LiveKit plugin built on top of this SDK).
// The underlying ID can only be set once per process, so callers must invoke this before
// constructing any Processor/Vad/Analyzer/FileAnalyzer, whose constructors otherwise claim
// the ID for this SDK first.
fn set_sdk_id(mut cx: FunctionContext) -> JsResult<JsUndefined> {
    let id = cx.argument::<JsNumber>(0)?.value(&mut cx) as u32;

    // SAFETY: This function has no safety requirements.
    unsafe {
        aic_sdk::set_sdk_id(id);
    }

    Ok(cx.undefined())
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    // Free functions
    cx.export_function("getVersion", get_sdk_version)?;
    cx.export_function("getCompatibleModelVersion", get_compatible_model_version)?;
    cx.export_function("setSdkId", set_sdk_id)?;

    // Model
    model::register_exports(&mut cx)?;

    // Processor
    processor::register_exports(&mut cx)?;

    // ProcessorContext
    processor_context::register_exports(&mut cx)?;

    // Vad / VadContext
    vad::register_exports(&mut cx)?;
    vad_context::register_exports(&mut cx)?;

    // Analyzer / Collector
    analyzer::register_exports(&mut cx)?;

    Ok(())
}
