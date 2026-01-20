use std::sync::{Arc, Mutex};

use neon::{
    handle::Handle,
    object::Object,
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{
        Finalize, JsArray, JsBoolean, JsBox, JsNumber, JsString, JsTypedArray, JsUndefined,
        buffer::TypedArray,
    },
};

use crate::model::Model;
use crate::processor_context::ProcessorContext;
use crate::vad_context::VadContext;

pub struct Processor {
    inner: Arc<Mutex<aic_sdk::Processor<'static>>>,
}

impl Finalize for Processor {
    fn finalize<'a, C: neon::prelude::Context<'a>>(self, _: &mut C) {}
}

impl Processor {
    pub fn new(mut cx: FunctionContext) -> JsResult<JsBox<Processor>> {
        let model = cx.argument::<JsBox<Model>>(0)?;
        let license_key = cx.argument::<JsString>(1)?.value(&mut cx);

        // SAFETY: This function has no safety requirements.
        unsafe {
            aic_sdk::set_sdk_id(4);
        }

        let processor = aic_sdk::Processor::new(&model.inner, &license_key)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.boxed(Processor {
            inner: Arc::new(Mutex::new(processor)),
        }))
    }

    pub fn initialize(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let sample_rate = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
        let num_channels = cx.argument::<JsNumber>(2)?.value(&mut cx) as u16;
        let num_frames = cx.argument::<JsNumber>(3)?.value(&mut cx) as usize;
        let allow_variable_frames = cx.argument::<JsBoolean>(4)?.value(&mut cx);

        let mut processor = this.inner.lock().unwrap();

        let config = aic_sdk::ProcessorConfig {
            sample_rate,
            num_channels,
            num_frames,
            allow_variable_frames,
        };

        processor
            .initialize(&config)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn process_interleaved(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let mut buffer = cx.argument::<JsTypedArray<f32>>(1)?;

        let mut processor = this.inner.lock().unwrap();

        let audio_data = buffer.as_mut_slice(&mut cx);

        processor
            .process_interleaved(audio_data)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn process_sequential(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let mut buffer = cx.argument::<JsTypedArray<f32>>(1)?;

        let mut processor = this.inner.lock().unwrap();

        let audio_data = buffer.as_mut_slice(&mut cx);

        processor
            .process_sequential(audio_data)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn process_planar(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let buffers = cx.argument::<JsArray>(1)?;

        let mut processor = this.inner.lock().unwrap();

        let length = buffers.len(&mut cx);

        if length > 16 {
            return cx.throw_error("Maximum 16 channels supported for planar processing");
        }

        // Use fixed-size arrays to avoid heap allocation
        let mut handles: [Option<Handle<JsTypedArray<f32>>>; 16] = Default::default();

        for i in 0..length {
            let buffer: Handle<JsTypedArray<f32>> = buffers.get(&mut cx, i)?;
            handles[i as usize] = Some(buffer);
        }

        // Create a fixed-size array of mutable slice pointers
        // SAFETY: We use unsafe here because Neon's borrow checker doesn't allow
        // getting multiple mutable slices at once, but we know:
        // 1. Each handle refers to a different JavaScript typed array
        // 2. The slices don't overlap
        // 3. The handles keep the buffers alive for the duration of this function
        let mut slice_array: [&mut [f32]; 16] = unsafe {
            let cx_ptr = &mut cx as *mut FunctionContext;
            let mut arr: [std::mem::MaybeUninit<&mut [f32]>; 16] =
                std::mem::MaybeUninit::uninit().assume_init();

            for i in 0..length as usize {
                if let Some(ref mut handle) = handles[i] {
                    let slice = handle.as_mut_slice(&mut *cx_ptr);
                    arr[i] = std::mem::MaybeUninit::new(slice);
                }
            }

            std::mem::transmute(arr)
        };

        let slice_refs = &mut slice_array[..length as usize];

        processor
            .process_planar(slice_refs)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn get_processor_context(mut cx: FunctionContext) -> JsResult<JsBox<ProcessorContext>> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let processor = this.inner.lock().unwrap();

        let context = processor.processor_context();

        Ok(cx.boxed(ProcessorContext { inner: context }))
    }

    pub fn get_vad_context(mut cx: FunctionContext) -> JsResult<JsBox<VadContext>> {
        let this = cx.argument::<JsBox<Processor>>(0)?;
        let processor = this.inner.lock().unwrap();

        let context = processor.vad_context();

        Ok(cx.boxed(VadContext { inner: context }))
    }
}

pub fn register_exports(cx: &mut neon::prelude::ModuleContext) -> NeonResult<()> {
    cx.export_function("processorNew", Processor::new)?;
    cx.export_function("processorInitialize", Processor::initialize)?;
    cx.export_function(
        "processorProcessInterleaved",
        Processor::process_interleaved,
    )?;
    cx.export_function("processorProcessSequential", Processor::process_sequential)?;
    cx.export_function("processorProcessPlanar", Processor::process_planar)?;
    cx.export_function(
        "processorGetProcessorContext",
        Processor::get_processor_context,
    )?;
    cx.export_function("processorGetVadContext", Processor::get_vad_context)?;

    Ok(())
}
