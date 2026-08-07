use std::sync::Mutex;

use neon::{
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{Finalize, JsBox, JsString, JsTypedArray, JsUndefined, buffer::TypedArray},
};

use crate::model::Model;
use crate::processor_context::ProcessorContext;
use crate::util::{parse_otel_config, parse_processor_config};

pub struct Processor {
    inner: Mutex<aic_sdk::Processor<'static>>,
}

impl Finalize for Processor {}

impl Processor {
    pub fn new(mut cx: FunctionContext) -> JsResult<JsBox<Processor>> {
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

        let processor = match &otel_config {
            Some(otel_config) => {
                aic_sdk::Processor::with_otel_config(&model.inner, &license_key, otel_config)
            }
            None => aic_sdk::Processor::new(&model.inner, &license_key),
        }
        .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.boxed(Processor {
            inner: Mutex::new(processor),
        }))
    }

    pub fn initialize(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let config = parse_processor_config(&mut cx, 1)?;

        let mut processor = this.inner.lock().unwrap();

        processor
            .initialize(&config)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn process(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let mut audio_block = cx.argument::<JsTypedArray<f32>>(1)?;

        let mut processor = this.inner.lock().unwrap();

        let samples = audio_block.as_mut_slice(&mut cx);

        processor
            .process(samples)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn get_context(mut cx: FunctionContext) -> JsResult<JsBox<ProcessorContext>> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let processor = this.inner.lock().unwrap();

        Ok(cx.boxed(ProcessorContext {
            inner: processor.context(),
        }))
    }

    pub fn terminate_session(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let mut processor = this.inner.lock().unwrap();

        processor
            .terminate_session()
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }
}

pub fn register_exports(cx: &mut neon::prelude::ModuleContext) -> NeonResult<()> {
    cx.export_function("processorNew", Processor::new)?;
    cx.export_function("processorInitialize", Processor::initialize)?;
    cx.export_function("processorProcess", Processor::process)?;
    cx.export_function("processorGetContext", Processor::get_context)?;
    cx.export_function("processorTerminateSession", Processor::terminate_session)?;

    Ok(())
}
