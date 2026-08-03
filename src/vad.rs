use std::sync::{Arc, Mutex};

use neon::{
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{Finalize, JsBoolean, JsBox, JsNumber, JsTypedArray, JsUndefined, buffer::TypedArray},
};

use crate::{model::Model, processor::parse_otel_config, vad_context::VadContext};

pub struct Vad {
    inner: Arc<Mutex<aic_sdk::Vad<'static>>>,
}

impl Finalize for Vad {
    fn finalize<'a, C: Context<'a>>(self, _: &mut C) {}
}

impl Vad {
    pub fn new(mut cx: FunctionContext) -> JsResult<JsBox<Vad>> {
        let model = cx.argument::<JsBox<Model>>(0)?;
        let license_key = cx.argument::<neon::types::JsString>(1)?.value(&mut cx);
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
            inner: Arc::new(Mutex::new(vad)),
        }))
    }

    pub fn initialize(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Vad>>(0)?;
        let sample_rate = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
        let block_size = cx.argument::<JsNumber>(2)?.value(&mut cx) as usize;
        let variable_block_size = cx.argument::<JsBoolean>(3)?.value(&mut cx);

        let config = aic_sdk::ProcessorConfig {
            sample_rate,
            block_size,
            variable_block_size,
        };

        this.inner
            .lock()
            .unwrap()
            .initialize(&config)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn process(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Vad>>(0)?;
        let mut audio_block = cx.argument::<JsTypedArray<f32>>(1)?;
        let samples = audio_block.as_mut_slice(&mut cx);

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
