use neon::{
    handle::Handle,
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{Finalize, JsBoolean, JsBox, JsNumber, JsUndefined, JsValue},
};

// VAD parameter constants
pub const VAD_PARAM_SPEECH_HOLD_DURATION: i32 = 0;
pub const VAD_PARAM_SENSITIVITY: i32 = 1;
pub const VAD_PARAM_MINIMUM_SPEECH_DURATION: i32 = 2;

pub fn parse_vad_parameter(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
) -> NeonResult<aic_sdk::VadParameter> {
    let param_num = value.downcast_or_throw::<JsNumber, _>(cx)?.value(cx) as i32;

    match param_num {
        VAD_PARAM_SPEECH_HOLD_DURATION => Ok(aic_sdk::VadParameter::SpeechHoldDuration),
        VAD_PARAM_SENSITIVITY => Ok(aic_sdk::VadParameter::Sensitivity),
        VAD_PARAM_MINIMUM_SPEECH_DURATION => Ok(aic_sdk::VadParameter::MinimumSpeechDuration),
        _ => cx.throw_error(format!("Invalid VAD parameter: {}", param_num)),
    }
}

pub struct VadContext {
    pub(crate) inner: aic_sdk::VadContext,
}

impl Finalize for VadContext {
    fn finalize<'a, C: neon::prelude::Context<'a>>(self, _: &mut C) {}
}

impl VadContext {
    pub fn is_speech_detected(mut cx: FunctionContext) -> JsResult<JsBoolean> {
        let this = cx.argument::<JsBox<VadContext>>(0)?;
        let detected = this.inner.is_speech_detected();
        Ok(cx.boolean(detected))
    }

    pub fn set_parameter(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<VadContext>>(0)?;
        let parameter_arg = cx.argument::<JsValue>(1)?;
        let parameter = parse_vad_parameter(&mut cx, parameter_arg)?;
        let value = cx.argument::<JsNumber>(2)?.value(&mut cx) as f32;

        this.inner
            .set_parameter(parameter, value)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn get_parameter(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<VadContext>>(0)?;
        let parameter_arg = cx.argument::<JsValue>(1)?;
        let parameter = parse_vad_parameter(&mut cx, parameter_arg)?;

        let value = this
            .inner
            .parameter(parameter)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.number(value as f64))
    }
}

pub fn register_exports(cx: &mut neon::prelude::ModuleContext) -> NeonResult<()> {
    cx.export_function("vadContextIsSpeechDetected", VadContext::is_speech_detected)?;
    cx.export_function("vadContextSetParameter", VadContext::set_parameter)?;
    cx.export_function("vadContextGetParameter", VadContext::get_parameter)?;

    // Export VAD parameter constants
    let speech_hold_duration = cx.number(VAD_PARAM_SPEECH_HOLD_DURATION);
    cx.export_value("VAD_PARAM_SPEECH_HOLD_DURATION", speech_hold_duration)?;
    let sensitivity = cx.number(VAD_PARAM_SENSITIVITY);
    cx.export_value("VAD_PARAM_SENSITIVITY", sensitivity)?;
    let min_speech_duration = cx.number(VAD_PARAM_MINIMUM_SPEECH_DURATION);
    cx.export_value("VAD_PARAM_MINIMUM_SPEECH_DURATION", min_speech_duration)?;

    Ok(())
}
