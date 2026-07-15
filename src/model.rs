use neon::{
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{Finalize, JsBox, JsNumber, JsString},
};

pub struct Model {
    pub(crate) inner: aic_sdk::Model<'static>,
    reported_bytes: i64,
}

impl Finalize for Model {
    fn finalize<'a, C: neon::prelude::Context<'a>>(self, cx: &mut C) {
        crate::mem::adjust(cx, -self.reported_bytes);
    }
}

impl Model {
    pub fn from_file(mut cx: FunctionContext) -> JsResult<JsBox<Model>> {
        let path = cx.argument::<JsString>(0)?.value(&mut cx);
        // The loaded weights are approximately the size of the model file on disk, so report
        // that real per-instance number rather than a constant. Fall back to a conservative
        // constant only if the file cannot be stat'd.
        let reported_bytes = std::fs::metadata(&path)
            .map(|m| m.len() as i64)
            .unwrap_or(crate::mem::MODEL_FALLBACK_BYTES);
        let inner = aic_sdk::Model::from_file(path).or_else(|e| cx.throw_error(e.to_string()))?;
        crate::mem::adjust(&mut cx, reported_bytes);
        Ok(cx.boxed(Model {
            inner,
            reported_bytes,
        }))
    }

    pub fn download(mut cx: FunctionContext) -> JsResult<JsString> {
        let model_id = cx.argument::<JsString>(0)?.value(&mut cx);
        let download_dir = cx.argument::<JsString>(1)?.value(&mut cx);
        let path = aic_sdk::Model::download(&model_id, download_dir)
            .or_else(|e| cx.throw_error(e.to_string()))?;
        Ok(cx.string(path.to_str().expect("Path can be converted to string")))
    }

    pub fn get_id(mut cx: FunctionContext) -> JsResult<JsString> {
        let this = cx.argument::<JsBox<Model>>(0)?;
        let id = this.inner.id();
        Ok(cx.string(id))
    }

    pub fn get_optimal_sample_rate(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<Model>>(0)?;
        let sample_rate = this.inner.optimal_sample_rate();
        Ok(cx.number(sample_rate))
    }

    pub fn get_optimal_num_frames(mut cx: FunctionContext) -> JsResult<JsNumber> {
        let this = cx.argument::<JsBox<Model>>(0)?;
        let sample_rate = cx.argument::<JsNumber>(1)?.value(&mut cx) as u32;
        let num_frames = this.inner.optimal_num_frames(sample_rate);
        Ok(cx.number(num_frames as f64))
    }
}

pub fn register_exports(cx: &mut neon::prelude::ModuleContext) -> NeonResult<()> {
    cx.export_function("modelFromFile", Model::from_file)?;
    cx.export_function("modelDownload", Model::download)?;
    cx.export_function("modelId", Model::get_id)?;
    cx.export_function("modelGetOptimalSampleRate", Model::get_optimal_sample_rate)?;
    cx.export_function("modelGetOptimalNumFrames", Model::get_optimal_num_frames)?;

    Ok(())
}
