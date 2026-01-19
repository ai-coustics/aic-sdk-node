use neon::{
    handle::Handle,
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{Finalize, JsBox, JsNumber, JsUndefined, JsValue},
};

// Processor parameter constants
pub const PROCESSOR_PARAM_BYPASS: i32 = 0;
pub const PROCESSOR_PARAM_ENHANCEMENT_LEVEL: i32 = 1;
pub const PROCESSOR_PARAM_VOICE_GAIN: i32 = 2;

pub fn parse_processor_parameter(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
) -> NeonResult<aic_sdk::ProcessorParameter> {
    let param_num = value.downcast_or_throw::<JsNumber, _>(cx)?.value(cx) as i32;

    match param_num {
        PROCESSOR_PARAM_BYPASS => Ok(aic_sdk::ProcessorParameter::Bypass),
        PROCESSOR_PARAM_ENHANCEMENT_LEVEL => Ok(aic_sdk::ProcessorParameter::EnhancementLevel),
        PROCESSOR_PARAM_VOICE_GAIN => Ok(aic_sdk::ProcessorParameter::VoiceGain),
        _ => cx.throw_error(format!("Invalid processor parameter: {}", param_num)),
    }
}

pub struct ProcessorContext {
    pub(crate) inner: aic_sdk::ProcessorContext,
}

impl Finalize for ProcessorContext {
    fn finalize<'a, C: neon::prelude::Context<'a>>(self, _: &mut C) {}
}

impl ProcessorContext {
    pub fn reset(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<ProcessorContext>>(0)?;
        this.inner
            .reset()
            .or_else(|e| cx.throw_error(e.to_string()))?;
        Ok(cx.undefined())
    }

    pub fn set_parameter(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<ProcessorContext>>(0)?;
        let parameter_arg = cx.argument::<JsValue>(1)?;
        let parameter = parse_processor_parameter(&mut cx, parameter_arg)?;
        let value = cx.argument::<JsNumber>(2)?.value(&mut cx) as f32;

        this.inner
            .set_parameter(parameter, value)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn get_parameter(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<ProcessorContext>>(0)?;
        let parameter_arg = cx.argument::<JsValue>(1)?;
        let parameter = parse_processor_parameter(&mut cx, parameter_arg)?;

        let value = this
            .inner
            .parameter(parameter)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.number(value as f64))
    }

    pub fn get_output_delay(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<ProcessorContext>>(0)?;
        let delay = this.inner.output_delay();
        Ok(cx.number(delay as f64))
    }
}

pub fn register_exports(cx: &mut neon::prelude::ModuleContext) -> NeonResult<()> {
    cx.export_function("processorContextReset", ProcessorContext::reset)?;
    cx.export_function(
        "processorContextSetParameter",
        ProcessorContext::set_parameter,
    )?;
    cx.export_function(
        "processorContextGetParameter",
        ProcessorContext::get_parameter,
    )?;
    cx.export_function(
        "processorContextGetOutputDelay",
        ProcessorContext::get_output_delay,
    )?;

    // Export processor parameter constants
    let bypass = cx.number(PROCESSOR_PARAM_BYPASS);
    cx.export_value("PROCESSOR_PARAM_BYPASS", bypass)?;
    let enhancement_level = cx.number(PROCESSOR_PARAM_ENHANCEMENT_LEVEL);
    cx.export_value("PROCESSOR_PARAM_ENHANCEMENT_LEVEL", enhancement_level)?;
    let voice_gain = cx.number(PROCESSOR_PARAM_VOICE_GAIN);
    cx.export_value("PROCESSOR_PARAM_VOICE_GAIN", voice_gain)?;

    Ok(())
}
