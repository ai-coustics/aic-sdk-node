use std::sync::{Arc, Mutex};

use neon::{
    handle::Handle,
    object::Object,
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{
        Finalize, JsBoolean, JsBox, JsNull, JsNumber, JsObject, JsString, JsTypedArray,
        JsUndefined, JsValue, buffer::TypedArray,
    },
};

use crate::model::Model;
use crate::processor_context::ProcessorContext;

pub struct Processor {
    inner: Arc<Mutex<aic_sdk::Processor<'static>>>,
}

impl Finalize for Processor {
    fn finalize<'a, C: neon::prelude::Context<'a>>(self, _: &mut C) {}
}

pub(crate) fn parse_otel_config(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
) -> NeonResult<Option<aic_sdk::OtelConfig>> {
    if value.is_a::<JsUndefined, _>(cx) || value.is_a::<JsNull, _>(cx) {
        return Ok(None);
    }

    let object = value.downcast_or_throw::<JsObject, _>(cx)?;
    let enable = object.get::<JsBoolean, _, _>(cx, "enable")?.value(cx);
    let session_id_value = object.get::<JsValue, _, _>(cx, "sessionId")?;
    let session_id =
        if session_id_value.is_a::<JsUndefined, _>(cx) || session_id_value.is_a::<JsNull, _>(cx) {
            None
        } else {
            Some(
                session_id_value
                    .downcast_or_throw::<JsString, _>(cx)?
                    .value(cx),
            )
        };

    let export_interval_value = object.get::<JsValue, _, _>(cx, "exportIntervalMs")?;
    let export_interval_ms = if export_interval_value.is_a::<JsUndefined, _>(cx)
        || export_interval_value.is_a::<JsNull, _>(cx)
    {
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
            inner: Arc::new(Mutex::new(processor)),
        }))
    }

    pub fn initialize(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let sample_rate = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
        let block_size = cx.argument::<JsNumber>(2)?.value(&mut cx) as usize;
        let variable_block_size = cx.argument::<JsBoolean>(3)?.value(&mut cx);

        let mut processor = this.inner.lock().unwrap();

        let config = aic_sdk::ProcessorConfig {
            sample_rate,
            block_size,
            variable_block_size,
        };

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
