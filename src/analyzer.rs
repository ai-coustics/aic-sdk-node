use std::sync::Mutex;

use neon::{
    handle::Handle,
    object::Object,
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{
        Finalize, JsArray, JsBoolean, JsBox, JsNumber, JsObject, JsString, JsTypedArray,
        JsUndefined, buffer::TypedArray,
    },
};

use crate::model::Model;

/// Buffers audio for later analysis by an [`Analyzer`].
///
/// Created together with an [`Analyzer`] via `analyzerPair`.
pub struct Collector {
    inner: Mutex<aic_sdk::Collector>,
}

impl Finalize for Collector {
    fn finalize<'a, C: Context<'a>>(self, _: &mut C) {}
}

/// Runs an analysis model over the audio buffered by a [`Collector`].
///
/// Created together with a [`Collector`] via `analyzerPair`.
pub struct Analyzer {
    inner: Mutex<aic_sdk::Analyzer<'static>>,
}

impl Finalize for Analyzer {
    fn finalize<'a, C: Context<'a>>(self, _: &mut C) {}
}

/// Creates a collector/analyzer pair for non-real-time analysis.
///
/// Returns a JS object with `collector` and `analyzer` native handles.
pub fn analyzer_pair(mut cx: FunctionContext) -> JsResult<JsObject> {
    let model = cx.argument::<JsBox<Model>>(0)?;
    let license_key = cx.argument::<JsString>(1)?.value(&mut cx);

    // SAFETY: This function has no safety requirements.
    unsafe {
        aic_sdk::set_sdk_id(4);
    }

    let (collector, analyzer) = aic_sdk::analyzer_pair(&model.inner, &license_key)
        .or_else(|e| cx.throw_error(e.to_string()))?;

    let collector_box = cx.boxed(Collector {
        inner: Mutex::new(collector),
    });
    let analyzer_box = cx.boxed(Analyzer {
        inner: Mutex::new(analyzer),
    });

    let result = cx.empty_object();
    result.set(&mut cx, "collector", collector_box)?;
    result.set(&mut cx, "analyzer", analyzer_box)?;

    Ok(result)
}

impl Collector {
    pub fn initialize(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Collector>>(0)?;
        let sample_rate = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
        let num_channels = cx.argument::<JsNumber>(2)?.value(&mut cx) as u16;
        let num_frames = cx.argument::<JsNumber>(3)?.value(&mut cx) as usize;
        let allow_variable_frames = cx.argument::<JsBoolean>(4)?.value(&mut cx);

        let mut collector = this.inner.lock().unwrap();

        let config = aic_sdk::ProcessorConfig {
            sample_rate,
            num_channels,
            num_frames,
            allow_variable_frames,
        };

        collector
            .initialize(&config)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn buffer_interleaved(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Collector>>(0)?;
        let buffer = cx.argument::<JsTypedArray<f32>>(1)?;

        let audio = buffer.as_slice(&cx);

        let mut collector = this.inner.lock().unwrap();
        collector
            .buffer_interleaved(audio)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn buffer_sequential(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Collector>>(0)?;
        let buffer = cx.argument::<JsTypedArray<f32>>(1)?;

        let audio = buffer.as_slice(&cx);

        let mut collector = this.inner.lock().unwrap();
        collector
            .buffer_sequential(audio)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }

    pub fn buffer_planar(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Collector>>(0)?;
        let buffers = cx.argument::<JsArray>(1)?;

        let length = buffers.len(&mut cx);
        if length > 16 {
            return cx.throw_error("Maximum 16 channels supported for planar buffering");
        }

        let mut handles: Vec<Handle<JsTypedArray<f32>>> = Vec::with_capacity(length as usize);
        for i in 0..length {
            handles.push(buffers.get(&mut cx, i)?);
        }

        // Buffering reads the channel data, so shared slices are sufficient and there is no
        // aliasing concern between channels.
        let slices: Vec<&[f32]> = handles.iter().map(|handle| handle.as_slice(&cx)).collect();

        let mut collector = this.inner.lock().unwrap();
        collector
            .buffer_planar(&slices)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }
}

impl Analyzer {
    pub fn reset(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Analyzer>>(0)?;
        let analyzer = this.inner.lock().unwrap();
        analyzer
            .reset()
            .or_else(|e| cx.throw_error(e.to_string()))?;
        Ok(cx.undefined())
    }

    pub fn analyze_buffered(mut cx: FunctionContext) -> JsResult<JsObject> {
        let this = cx.argument::<JsBox<Analyzer>>(0)?;

        let result = {
            let mut analyzer = this.inner.lock().unwrap();
            analyzer
                .analyze_buffered()
                .or_else(|e| cx.throw_error(e.to_string()))?
        };

        let obj = cx.empty_object();
        let fields: [(&str, f32); 7] = [
            ("riskScore", result.risk_score),
            ("speakerReverb", result.speaker_reverb),
            ("speakerLoudness", result.speaker_loudness),
            ("interferingSpeech", result.interfering_speech),
            ("mediaSpeech", result.media_speech),
            ("noise", result.noise),
            ("packetLoss", result.packet_loss),
        ];
        for (key, value) in fields {
            let number = cx.number(value as f64);
            obj.set(&mut cx, key, number)?;
        }

        Ok(obj)
    }

    pub fn update_bearer_token(mut cx: FunctionContext) -> JsResult<JsUndefined> {
        let this = cx.argument::<JsBox<Analyzer>>(0)?;
        let token = cx.argument::<JsString>(1)?.value(&mut cx);

        let analyzer = this.inner.lock().unwrap();
        analyzer
            .update_bearer_token(&token)
            .or_else(|e| cx.throw_error(e.to_string()))?;

        Ok(cx.undefined())
    }
}

pub fn register_exports(cx: &mut neon::prelude::ModuleContext) -> NeonResult<()> {
    cx.export_function("analyzerPair", analyzer_pair)?;

    cx.export_function("collectorInitialize", Collector::initialize)?;
    cx.export_function("collectorBufferInterleaved", Collector::buffer_interleaved)?;
    cx.export_function("collectorBufferSequential", Collector::buffer_sequential)?;
    cx.export_function("collectorBufferPlanar", Collector::buffer_planar)?;

    cx.export_function("analyzerReset", Analyzer::reset)?;
    cx.export_function("analyzerAnalyzeBuffered", Analyzer::analyze_buffered)?;
    cx.export_function("analyzerUpdateBearerToken", Analyzer::update_bearer_token)?;

    Ok(())
}
