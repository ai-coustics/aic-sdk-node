use neon::{
    prelude::{Context, FunctionContext},
    result::{JsResult, NeonResult},
    types::{Finalize, JsBox, JsNumber, JsString},
};

pub struct Model {
    pub(crate) inner: aic_sdk::Model<'static>,
}

impl Finalize for Model {
    fn finalize<'a, C: neon::prelude::Context<'a>>(self, _: &mut C) {}
}

impl Model {
    pub fn from_file(mut cx: FunctionContext) -> JsResult<JsBox<Model>> {
        let path = cx.argument::<JsString>(0)?.value(&mut cx);
        let inner = aic_sdk::Model::from_file(path).or_else(|e| cx.throw_error(e.to_string()))?;
        Ok(cx.boxed(Model { inner }))
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
