use std::sync::Mutex;

use neon::{
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{Finalize, JsBox, JsString, JsTypedArray, JsUndefined, buffer::TypedArray},
};

use crate::{
    model::Model,
    util::{parse_otel_config, parse_processor_config},
    vad_context::VadContext,
};

pub struct Vad {
    inner: Mutex<aic_sdk::Vad<'static>>,
}

impl Finalize for Vad {}

impl Vad {
    pub fn new(mut cx: FunctionContext) -> JsResult<JsBox<Vad>> {
        let model = cx.argument::<JsBox<Model>>(0)?;
        let license_key = cx.argument::<JsString>(1)?.value(&mut cx);
        let otel_config = match cx.argument_opt(2) {
            Some(value) => parse_otel_config(&mut cx, value)?,
            None => None,
        };

        // SAFETY: This function has no safety requirements.
        unsafe {
            aic_sdk::set_sdk_id(4);
        }

        let vad = match &otel_config {
            Some(otel_config) => {
                aic_sdk::Vad::with_otel_config(&model.inner, &license_key, otel_config)
            }
            None => aic_sdk::Vad::new(&model.inner, &license_key),
        }
        .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.boxed(Vad {
            inner: Mutex::new(vad),
        }))
    }

    pub fn initialize(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Vad>>(0)?;
        let config = parse_processor_config(&mut cx, 1)?;

        this.inner
            .lock()
            .unwrap()
            .initialize(&config)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn process(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Vad>>(0)?;
        let audio_block = cx.argument::<JsTypedArray<f32>>(1)?;
        let samples = audio_block.as_slice(&cx);

        this.inner
            .lock()
            .unwrap()
            .process(samples)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn get_context(mut cx: FunctionContext) -> JsResult<JsBox<VadContext>> {
        let this = cx.argument::<JsBox<Vad>>(0)?;
        let vad = this.inner.lock().unwrap();

        Ok(cx.boxed(VadContext {
            inner: vad.context(),
        }))
    }

    pub fn terminate_session(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Vad>>(0)?;

        this.inner
            .lock()
            .unwrap()
            .terminate_session()
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }
}

pub fn register_exports(cx: &mut neon::prelude::ModuleContext) -> NeonResult<()> {
    cx.export_function("vadNew", Vad::new)?;
    cx.export_function("vadInitialize", Vad::initialize)?;
    cx.export_function("vadProcess", Vad::process)?;
    cx.export_function("vadGetContext", Vad::get_context)?;
    cx.export_function("vadTerminateSession", Vad::terminate_session)?;

    Ok(())
}
