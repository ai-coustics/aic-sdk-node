use aic_sdk::{EnhancementParameter, Model as AicModel, ModelType, Vad as AicVad, VadParameter};
use neon::prelude::*;
use neon::types::buffer::TypedArray;
use std::cell::RefCell;
use std::sync::{Arc, Mutex};

// ============================================================================
// SDK Version
// ============================================================================

fn get_sdk_version(mut cx: FunctionContext) -> JsResult<JsString> {
    let version = aic_sdk::get_version();
    Ok(cx.string(version))
}

// ============================================================================
// Model Type Enum
// ============================================================================

fn parse_model_type(cx: &mut FunctionContext, value: Handle<JsValue>) -> NeonResult<ModelType> {
    let s = value.downcast_or_throw::<JsString, _>(cx)?;
    let model_str = s.value(cx);

    match model_str.as_str() {
        "QuailL48" => Ok(ModelType::QuailL48),
        "QuailL16" => Ok(ModelType::QuailL16),
        "QuailL8" => Ok(ModelType::QuailL8),
        "QuailS48" => Ok(ModelType::QuailS48),
        "QuailS16" => Ok(ModelType::QuailS16),
        "QuailS8" => Ok(ModelType::QuailS8),
        "QuailXs" => Ok(ModelType::QuailXs),
        "QuailXxs" => Ok(ModelType::QuailXxs),
        "QuailSttL16" => Ok(ModelType::QuailSttL16),
        "QuailSttL8" => Ok(ModelType::QuailSttL8),
        "QuailSttS16" => Ok(ModelType::QuailSttS16),
        "QuailSttS8" => Ok(ModelType::QuailSttS8),
        "QuailVfSttL16" => Ok(ModelType::QuailVfSttL16),
        _ => cx.throw_error(format!("Invalid model type: {}", model_str)),
    }
}

// ============================================================================
// Enhancement Parameter Enum
// ============================================================================

// Enhancement parameter constants
const ENHANCEMENT_PARAM_BYPASS: i32 = 0;
const ENHANCEMENT_PARAM_ENHANCEMENT_LEVEL: i32 = 1;
const ENHANCEMENT_PARAM_VOICE_GAIN: i32 = 2;

fn parse_enhancement_parameter(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
) -> NeonResult<EnhancementParameter> {
    let param_num = value.downcast_or_throw::<JsNumber, _>(cx)?.value(cx) as i32;

    match param_num {
        ENHANCEMENT_PARAM_BYPASS => Ok(EnhancementParameter::Bypass),
        ENHANCEMENT_PARAM_ENHANCEMENT_LEVEL => Ok(EnhancementParameter::EnhancementLevel),
        ENHANCEMENT_PARAM_VOICE_GAIN => Ok(EnhancementParameter::VoiceGain),
        _ => cx.throw_error(format!("Invalid enhancement parameter: {}", param_num)),
    }
}

// ============================================================================
// VAD Parameter Enum
// ============================================================================

// VAD parameter constants
const VAD_PARAM_SPEECH_HOLD_DURATION: i32 = 0;
const VAD_PARAM_SENSITIVITY: i32 = 1;
const VAD_PARAM_MINIMUM_SPEECH_DURATION: i32 = 2;

fn parse_vad_parameter(
    cx: &mut FunctionContext,
    value: Handle<JsValue>,
) -> NeonResult<VadParameter> {
    let param_num = value.downcast_or_throw::<JsNumber, _>(cx)?.value(cx) as i32;

    match param_num {
        VAD_PARAM_SPEECH_HOLD_DURATION => Ok(VadParameter::SpeechHoldDuration),
        VAD_PARAM_SENSITIVITY => Ok(VadParameter::Sensitivity),
        VAD_PARAM_MINIMUM_SPEECH_DURATION => Ok(VadParameter::MinimumSpeechDuration),
        _ => cx.throw_error(format!("Invalid VAD parameter: {}", param_num)),
    }
}

// ============================================================================
// Model Class
// ============================================================================

pub struct JsModel {
    model: Arc<Mutex<AicModel>>,
}

impl Finalize for JsModel {}

impl JsModel {
    fn js_new(mut cx: FunctionContext) -> JsResult<JsBox<RefCell<JsModel>>> {
        let model_type_arg = cx.argument::<JsValue>(0)?;
        let model_type = parse_model_type(&mut cx, model_type_arg)?;
        let license = cx.argument::<JsString>(1)?.value(&mut cx);

        let model = AicModel::new(model_type, &license)
            .or_else(|e| cx.throw_error(format!("Failed to create model: {}", e)))?;

        Ok(cx.boxed(RefCell::new(JsModel {
            model: Arc::new(Mutex::new(model)),
        })))
    }

    fn js_optimal_sample_rate(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let this = this.borrow();
        let model = this.model.lock().unwrap();

        let sample_rate = model
            .optimal_sample_rate()
            .or_else(|e| cx.throw_error(format!("Failed to get optimal sample rate: {}", e)))?;

        Ok(cx.number(sample_rate as f64))
    }

    fn js_optimal_num_frames(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let sample_rate = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;

        let this = this.borrow();
        let model = this.model.lock().unwrap();

        let num_frames = model
            .optimal_num_frames(sample_rate)
            .or_else(|e| cx.throw_error(format!("Failed to get optimal num frames: {}", e)))?;

        Ok(cx.number(num_frames as f64))
    }

    fn js_initialize(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let sample_rate = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
        let num_channels = cx.argument::<JsNumber>(2)?.value(&mut cx) as u16;
        let num_frames = cx.argument::<JsNumber>(3)?.value(&mut cx) as usize;
        let allow_variable_frames = cx.argument::<JsBoolean>(4)?.value(&mut cx);

        let this = this.borrow();
        let mut model = this.model.lock().unwrap();

        model
            .initialize(sample_rate, num_channels, num_frames, allow_variable_frames)
            .or_else(|e| cx.throw_error(format!("Failed to initialize model: {}", e)))?;

        Ok(cx.undefined())
    }

    fn js_output_delay(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let this = this.borrow();
        let model = this.model.lock().unwrap();

        let delay = model
            .output_delay()
            .or_else(|e| cx.throw_error(format!("Failed to get output delay: {}", e)))?;

        Ok(cx.number(delay as f64))
    }

    fn js_reset(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let this = this.borrow();
        let mut model = this.model.lock().unwrap();

        model
            .reset()
            .or_else(|e| cx.throw_error(format!("Failed to reset model: {}", e)))?;

        Ok(cx.undefined())
    }

    fn js_set_parameter(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let parameter_arg = cx.argument::<JsValue>(1)?;
        let parameter = parse_enhancement_parameter(&mut cx, parameter_arg)?;
        let value = cx.argument::<JsNumber>(2)?.value(&mut cx) as f32;

        let this = this.borrow();
        let mut model = this.model.lock().unwrap();

        model
            .set_parameter(parameter, value)
            .or_else(|e| cx.throw_error(format!("Failed to set parameter: {}", e)))?;

        Ok(cx.undefined())
    }

    fn js_get_parameter(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let parameter_arg = cx.argument::<JsValue>(1)?;
        let parameter = parse_enhancement_parameter(&mut cx, parameter_arg)?;

        let this = this.borrow();
        let model = this.model.lock().unwrap();

        let value = model
            .parameter(parameter)
            .or_else(|e| cx.throw_error(format!("Failed to get parameter: {}", e)))?;

        Ok(cx.number(value as f64))
    }

    fn js_process_interleaved(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let mut buffer = cx.argument::<JsTypedArray<f32>>(1)?;

        let this = this.borrow();
        let mut model = this.model.lock().unwrap();

        // Get mutable slice from the typed array
        let audio_data = buffer.as_mut_slice(&mut cx);

        model
            .process_interleaved(audio_data)
            .or_else(|e| cx.throw_error(format!("Failed to process audio: {}", e)))?;

        Ok(cx.undefined())
    }

    fn js_process_planar(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let buffers = cx.argument::<JsArray>(1)?;

        let this = this.borrow();
        let mut model = this.model.lock().unwrap();

        // Convert JS array of typed arrays to fixed-size array (max 16 channels)
        let length = buffers.len(&mut cx);

        // Limit to maximum 16 channels to avoid heap allocation
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
                    // Each iteration uses a fresh pointer to cx, avoiding borrow checker issues
                    let slice = handle.as_mut_slice(&mut *cx_ptr);
                    arr[i] = std::mem::MaybeUninit::new(slice);
                }
            }

            // Transmute the initialized portion to the correct type
            std::mem::transmute(arr)
        };

        // Use only the initialized portion of the array
        let slice_refs = &mut slice_array[..length as usize];

        model
            .process_planar(slice_refs)
            .or_else(|e| cx.throw_error(format!("Failed to process planar audio: {}", e)))?;

        Ok(cx.undefined())
    }

    fn js_create_vad(mut cx: FunctionContext) -> JsResult<JsBox<RefCell<JsVad>>> {
        let this = cx.argument::<JsBox<RefCell<JsModel>>>(0)?;
        let this = this.borrow();
        let mut model = this.model.lock().unwrap();

        let vad = model.create_vad();

        Ok(cx.boxed(RefCell::new(JsVad {
            vad: Arc::new(Mutex::new(vad)),
        })))
    }
}

// ============================================================================
// VAD Class
// ============================================================================

pub struct JsVad {
    vad: Arc<Mutex<AicVad>>,
}

impl Finalize for JsVad {}

impl JsVad {
    fn js_is_speech_detected(mut cx: FunctionContext) -> JsResult<JsBoolean> {
        let this = cx.argument::<JsBox<RefCell<JsVad>>>(0)?;
        let this = this.borrow();
        let vad = this.vad.lock().unwrap();

        let detected = vad.is_speech_detected();

        Ok(cx.boolean(detected))
    }

    fn js_set_parameter(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<RefCell<JsVad>>>(0)?;
        let parameter_arg = cx.argument::<JsValue>(1)?;
        let parameter = parse_vad_parameter(&mut cx, parameter_arg)?;
        let value = cx.argument::<JsNumber>(2)?.value(&mut cx) as f32;

        let this = this.borrow();
        let mut vad = this.vad.lock().unwrap();

        vad.set_parameter(parameter, value)
            .or_else(|e| cx.throw_error(format!("Failed to set VAD parameter: {}", e)))?;

        Ok(cx.undefined())
    }

    fn js_get_parameter(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<RefCell<JsVad>>>(0)?;
        let parameter_arg = cx.argument::<JsValue>(1)?;
        let parameter = parse_vad_parameter(&mut cx, parameter_arg)?;

        let this = this.borrow();
        let vad = this.vad.lock().unwrap();

        let value = vad
            .parameter(parameter)
            .or_else(|e| cx.throw_error(format!("Failed to get VAD parameter: {}", e)))?;

        Ok(cx.number(value as f64))
    }
}

// ============================================================================
// Module Exports
// ============================================================================

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    // Export SDK version function
    cx.export_function("getVersion", get_sdk_version)?;

    // Export Model class
    cx.export_function("modelNew", JsModel::js_new)?;
    cx.export_function("modelOptimalSampleRate", JsModel::js_optimal_sample_rate)?;
    cx.export_function("modelOptimalNumFrames", JsModel::js_optimal_num_frames)?;
    cx.export_function("modelInitialize", JsModel::js_initialize)?;
    cx.export_function("modelOutputDelay", JsModel::js_output_delay)?;
    cx.export_function("modelReset", JsModel::js_reset)?;
    cx.export_function("modelSetParameter", JsModel::js_set_parameter)?;
    cx.export_function("modelGetParameter", JsModel::js_get_parameter)?;
    cx.export_function("modelProcessInterleaved", JsModel::js_process_interleaved)?;
    cx.export_function("modelProcessPlanar", JsModel::js_process_planar)?;
    cx.export_function("modelCreateVad", JsModel::js_create_vad)?;

    // Export VAD class
    cx.export_function("vadIsSpeechDetected", JsVad::js_is_speech_detected)?;
    cx.export_function("vadSetParameter", JsVad::js_set_parameter)?;
    cx.export_function("vadGetParameter", JsVad::js_get_parameter)?;

    // Export enhancement parameter constants
    let bypass = cx.number(ENHANCEMENT_PARAM_BYPASS);
    cx.export_value("ENHANCEMENT_PARAM_BYPASS", bypass)?;
    let enhancement_level = cx.number(ENHANCEMENT_PARAM_ENHANCEMENT_LEVEL);
    cx.export_value("ENHANCEMENT_PARAM_ENHANCEMENT_LEVEL", enhancement_level)?;
    let voice_gain = cx.number(ENHANCEMENT_PARAM_VOICE_GAIN);
    cx.export_value("ENHANCEMENT_PARAM_VOICE_GAIN", voice_gain)?;

    // Export VAD parameter constants
    let lookback = cx.number(VAD_PARAM_SPEECH_HOLD_DURATION);
    cx.export_value("VAD_PARAM_SPEECH_HOLD_DURATION", lookback)?;
    let sensitivity = cx.number(VAD_PARAM_SENSITIVITY);
    cx.export_value("VAD_PARAM_SENSITIVITY", sensitivity)?;
    let min_speech_duration = cx.number(VAD_PARAM_MINIMUM_SPEECH_DURATION);
    cx.export_value("VAD_PARAM_MINIMUM_SPEECH_DURATION", min_speech_duration)?;

    Ok(())
}
