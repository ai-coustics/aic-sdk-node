#include "../sdk/include/aic.h"
#include <napi.h>
#include <string>
#include <vector>

class ModelWrapper : public Napi::ObjectWrap<ModelWrapper> {
public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports);
  ModelWrapper(const Napi::CallbackInfo &info);
  ~ModelWrapper();

private:
  AicModel *model_;

  Napi::Value Initialize(const Napi::CallbackInfo &info);
  Napi::Value Reset(const Napi::CallbackInfo &info);
  Napi::Value ProcessInterleaved(const Napi::CallbackInfo &info);
  Napi::Value ProcessPlanar(const Napi::CallbackInfo &info);
  Napi::Value SetParameter(const Napi::CallbackInfo &info);
  Napi::Value GetParameter(const Napi::CallbackInfo &info);
  Napi::Value GetOutputDelay(const Napi::CallbackInfo &info);
  Napi::Value GetOptimalSampleRate(const Napi::CallbackInfo &info);
  Napi::Value GetOptimalNumFrames(const Napi::CallbackInfo &info);
};

ModelWrapper::ModelWrapper(const Napi::CallbackInfo &info)
    : Napi::ObjectWrap<ModelWrapper>(info), model_(nullptr) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsExternal()) {
    Napi::TypeError::New(env, "Expected external model handle")
        .ThrowAsJavaScriptException();
    return;
  }

  model_ = info[0].As<Napi::External<AicModel>>().Data();
}

ModelWrapper::~ModelWrapper() {
  if (model_) {
    aic_model_destroy(model_);
    model_ = nullptr;
  }
}

Napi::Object ModelWrapper::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function func = DefineClass(
      env, "ModelWrapper",
      {
          InstanceMethod("initialize", &ModelWrapper::Initialize),
          InstanceMethod("reset", &ModelWrapper::Reset),
          InstanceMethod("processInterleaved",
                         &ModelWrapper::ProcessInterleaved),
          InstanceMethod("processPlanar", &ModelWrapper::ProcessPlanar),
          InstanceMethod("setParameter", &ModelWrapper::SetParameter),
          InstanceMethod("getParameter", &ModelWrapper::GetParameter),
          InstanceMethod("getOutputDelay", &ModelWrapper::GetOutputDelay),
          InstanceMethod("getOptimalSampleRate",
                         &ModelWrapper::GetOptimalSampleRate),
          InstanceMethod("getOptimalNumFrames",
                         &ModelWrapper::GetOptimalNumFrames),
      });

  Napi::FunctionReference *constructor = new Napi::FunctionReference();
  *constructor = Napi::Persistent(func);
  env.SetInstanceData(constructor);

  return exports;
}

Napi::Value ModelWrapper::Initialize(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3) {
    Napi::TypeError::New(env, "Expected 3 arguments")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  uint32_t sample_rate = info[0].As<Napi::Number>().Uint32Value();
  uint16_t num_channels = info[1].As<Napi::Number>().Uint32Value();
  size_t num_frames = info[2].As<Napi::Number>().Uint32Value();

  AicErrorCode error =
      aic_model_initialize(model_, sample_rate, num_channels, num_frames);
  return Napi::Number::New(env, static_cast<int>(error));
}

Napi::Value ModelWrapper::Reset(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  AicErrorCode error = aic_model_reset(model_);
  return Napi::Number::New(env, static_cast<int>(error));
}

Napi::Value ModelWrapper::ProcessInterleaved(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3 || !info[0].IsTypedArray()) {
    Napi::TypeError::New(env, "Expected Float32Array and dimensions")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Float32Array array = info[0].As<Napi::Float32Array>();
  uint16_t num_channels = info[1].As<Napi::Number>().Uint32Value();
  size_t num_frames = info[2].As<Napi::Number>().Uint32Value();

  float *data = array.Data();
  AicErrorCode error =
      aic_model_process_interleaved(model_, data, num_channels, num_frames);

  return Napi::Number::New(env, static_cast<int>(error));
}

Napi::Value ModelWrapper::ProcessPlanar(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 3 || !info[0].IsArray()) {
    Napi::TypeError::New(env, "Expected array of Float32Arrays and dimensions")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Array arrays = info[0].As<Napi::Array>();
  uint16_t num_channels = info[1].As<Napi::Number>().Uint32Value();
  size_t num_frames = info[2].As<Napi::Number>().Uint32Value();

  std::vector<float *> channel_data(num_channels);
  for (uint16_t i = 0; i < num_channels; i++) {
    Napi::Value val = arrays[i];
    if (!val.IsTypedArray()) {
      Napi::TypeError::New(env, "Expected Float32Array")
          .ThrowAsJavaScriptException();
      return env.Null();
    }
    Napi::Float32Array channel = val.As<Napi::Float32Array>();
    channel_data[i] = channel.Data();
  }

  AicErrorCode error = aic_model_process_planar(model_, channel_data.data(),
                                                num_channels, num_frames);
  return Napi::Number::New(env, static_cast<int>(error));
}

Napi::Value ModelWrapper::SetParameter(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected parameter and value")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  AicParameter param =
      static_cast<AicParameter>(info[0].As<Napi::Number>().Int32Value());
  float value = info[1].As<Napi::Number>().FloatValue();

  AicErrorCode error = aic_model_set_parameter(model_, param, value);
  return Napi::Number::New(env, static_cast<int>(error));
}

Napi::Value ModelWrapper::GetParameter(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1) {
    Napi::TypeError::New(env, "Expected parameter")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  AicParameter param =
      static_cast<AicParameter>(info[0].As<Napi::Number>().Int32Value());
  float value = 0.0f;

  AicErrorCode error = aic_model_get_parameter(model_, param, &value);

  Napi::Object result = Napi::Object::New(env);
  result.Set("error", Napi::Number::New(env, static_cast<int>(error)));
  result.Set("value", Napi::Number::New(env, value));
  return result;
}

Napi::Value ModelWrapper::GetOutputDelay(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  size_t delay = 0;
  AicErrorCode error = aic_get_output_delay(model_, &delay);

  Napi::Object result = Napi::Object::New(env);
  result.Set("error", Napi::Number::New(env, static_cast<int>(error)));
  result.Set("delay", Napi::Number::New(env, delay));
  return result;
}

Napi::Value ModelWrapper::GetOptimalSampleRate(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  uint32_t sample_rate = 0;
  AicErrorCode error = aic_get_optimal_sample_rate(model_, &sample_rate);

  Napi::Object result = Napi::Object::New(env);
  result.Set("error", Napi::Number::New(env, static_cast<int>(error)));
  result.Set("sampleRate", Napi::Number::New(env, sample_rate));
  return result;
}

Napi::Value ModelWrapper::GetOptimalNumFrames(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  size_t num_frames = 0;
  AicErrorCode error = aic_get_optimal_num_frames(model_, &num_frames);

  Napi::Object result = Napi::Object::New(env);
  result.Set("error", Napi::Number::New(env, static_cast<int>(error)));
  result.Set("numFrames", Napi::Number::New(env, num_frames));
  return result;
}

// Module functions
Napi::Value CreateModel(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2) {
    Napi::TypeError::New(env, "Expected model type and license key")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  AicModelType model_type =
      static_cast<AicModelType>(info[0].As<Napi::Number>().Int32Value());
  std::string license_key = info[1].As<Napi::String>().Utf8Value();

  AicModel *model = nullptr;
  AicErrorCode error =
      aic_model_create(&model, model_type, license_key.c_str());

  Napi::Object result = Napi::Object::New(env);
  result.Set("error", Napi::Number::New(env, static_cast<int>(error)));

  if (error == AIC_ERROR_CODE_SUCCESS && model != nullptr) {
    result.Set("model", Napi::External<AicModel>::New(env, model));
  } else {
    result.Set("model", env.Null());
  }

  return result;
}

Napi::Value DestroyModel(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsExternal()) {
    return env.Null();
  }

  AicModel *model = info[0].As<Napi::External<AicModel>>().Data();
  if (model) {
    aic_model_destroy(model);
  }

  return env.Null();
}

Napi::Value GetSdkVersion(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  const char *version = aic_get_sdk_version();
  return Napi::String::New(env, version);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createModel", Napi::Function::New(env, CreateModel));
  exports.Set("destroyModel", Napi::Function::New(env, DestroyModel));
  exports.Set("getSdkVersion", Napi::Function::New(env, GetSdkVersion));

  // Helper functions that delegate to ModelWrapper methods
  exports.Set(
      "initialize",
      Napi::Function::New(
          env, [](const Napi::CallbackInfo &info) -> Napi::Value {
            Napi::Env env = info.Env();
            if (!info[0].IsExternal()) {
              Napi::TypeError::New(env, "Expected model handle")
                  .ThrowAsJavaScriptException();
              return env.Null();
            }
            AicModel *model = info[0].As<Napi::External<AicModel>>().Data();
            uint32_t sample_rate = info[1].As<Napi::Number>().Uint32Value();
            uint16_t num_channels = info[2].As<Napi::Number>().Uint32Value();
            size_t num_frames = info[3].As<Napi::Number>().Uint32Value();
            AicErrorCode error = aic_model_initialize(model, sample_rate,
                                                      num_channels, num_frames);
            return Napi::Number::New(env, static_cast<int>(error));
          }));

  exports.Set("reset",
              Napi::Function::New(
                  env, [](const Napi::CallbackInfo &info) -> Napi::Value {
                    Napi::Env env = info.Env();
                    if (!info[0].IsExternal()) {
                      Napi::TypeError::New(env, "Expected model handle")
                          .ThrowAsJavaScriptException();
                      return env.Null();
                    }
                    AicModel *model =
                        info[0].As<Napi::External<AicModel>>().Data();
                    AicErrorCode error = aic_model_reset(model);
                    return Napi::Number::New(env, static_cast<int>(error));
                  }));

  exports.Set(
      "processInterleaved",
      Napi::Function::New(
          env, [](const Napi::CallbackInfo &info) -> Napi::Value {
            Napi::Env env = info.Env();
            if (!info[0].IsExternal() || !info[1].IsTypedArray()) {
              Napi::TypeError::New(env, "Invalid arguments")
                  .ThrowAsJavaScriptException();
              return env.Null();
            }
            AicModel *model = info[0].As<Napi::External<AicModel>>().Data();
            Napi::Float32Array array = info[1].As<Napi::Float32Array>();
            uint16_t num_channels = info[2].As<Napi::Number>().Uint32Value();
            size_t num_frames = info[3].As<Napi::Number>().Uint32Value();
            float *data = array.Data();
            AicErrorCode error = aic_model_process_interleaved(
                model, data, num_channels, num_frames);
            return Napi::Number::New(env, static_cast<int>(error));
          }));

  exports.Set(
      "processPlanar",
      Napi::Function::New(
          env, [](const Napi::CallbackInfo &info) -> Napi::Value {
            Napi::Env env = info.Env();
            if (!info[0].IsExternal() || !info[1].IsArray()) {
              Napi::TypeError::New(env, "Invalid arguments")
                  .ThrowAsJavaScriptException();
              return env.Null();
            }
            AicModel *model = info[0].As<Napi::External<AicModel>>().Data();
            Napi::Array arrays = info[1].As<Napi::Array>();
            uint16_t num_channels = info[2].As<Napi::Number>().Uint32Value();
            size_t num_frames = info[3].As<Napi::Number>().Uint32Value();

            std::vector<float *> channel_data(num_channels);
            for (uint16_t i = 0; i < num_channels; i++) {
              Napi::Value val = arrays[i];
              if (!val.IsTypedArray()) {
                Napi::TypeError::New(env, "Expected Float32Array")
                    .ThrowAsJavaScriptException();
                return env.Null();
              }
              Napi::Float32Array channel = val.As<Napi::Float32Array>();
              channel_data[i] = channel.Data();
            }

            AicErrorCode error = aic_model_process_planar(
                model, channel_data.data(), num_channels, num_frames);
            return Napi::Number::New(env, static_cast<int>(error));
          }));

  exports.Set("setParameter",
              Napi::Function::New(
                  env, [](const Napi::CallbackInfo &info) -> Napi::Value {
                    Napi::Env env = info.Env();
                    if (!info[0].IsExternal()) {
                      Napi::TypeError::New(env, "Expected model handle")
                          .ThrowAsJavaScriptException();
                      return env.Null();
                    }
                    AicModel *model =
                        info[0].As<Napi::External<AicModel>>().Data();
                    AicParameter param = static_cast<AicParameter>(
                        info[1].As<Napi::Number>().Int32Value());
                    float value = info[2].As<Napi::Number>().FloatValue();
                    AicErrorCode error =
                        aic_model_set_parameter(model, param, value);
                    return Napi::Number::New(env, static_cast<int>(error));
                  }));

  exports.Set("getParameter",
              Napi::Function::New(
                  env, [](const Napi::CallbackInfo &info) -> Napi::Value {
                    Napi::Env env = info.Env();
                    if (!info[0].IsExternal()) {
                      Napi::TypeError::New(env, "Expected model handle")
                          .ThrowAsJavaScriptException();
                      return env.Null();
                    }
                    AicModel *model =
                        info[0].As<Napi::External<AicModel>>().Data();
                    AicParameter param = static_cast<AicParameter>(
                        info[1].As<Napi::Number>().Int32Value());
                    float value = 0.0f;
                    AicErrorCode error =
                        aic_model_get_parameter(model, param, &value);
                    Napi::Object result = Napi::Object::New(env);
                    result.Set("error",
                               Napi::Number::New(env, static_cast<int>(error)));
                    result.Set("value", Napi::Number::New(env, value));
                    return result;
                  }));

  exports.Set("getOutputDelay",
              Napi::Function::New(
                  env, [](const Napi::CallbackInfo &info) -> Napi::Value {
                    Napi::Env env = info.Env();
                    if (!info[0].IsExternal()) {
                      Napi::TypeError::New(env, "Expected model handle")
                          .ThrowAsJavaScriptException();
                      return env.Null();
                    }
                    AicModel *model =
                        info[0].As<Napi::External<AicModel>>().Data();
                    size_t delay = 0;
                    AicErrorCode error = aic_get_output_delay(model, &delay);
                    Napi::Object result = Napi::Object::New(env);
                    result.Set("error",
                               Napi::Number::New(env, static_cast<int>(error)));
                    result.Set("delay", Napi::Number::New(env, delay));
                    return result;
                  }));

  exports.Set(
      "getOptimalSampleRate",
      Napi::Function::New(
          env, [](const Napi::CallbackInfo &info) -> Napi::Value {
            Napi::Env env = info.Env();
            if (!info[0].IsExternal()) {
              Napi::TypeError::New(env, "Expected model handle")
                  .ThrowAsJavaScriptException();
              return env.Null();
            }
            AicModel *model = info[0].As<Napi::External<AicModel>>().Data();
            uint32_t sample_rate = 0;
            AicErrorCode error =
                aic_get_optimal_sample_rate(model, &sample_rate);
            Napi::Object result = Napi::Object::New(env);
            result.Set("error",
                       Napi::Number::New(env, static_cast<int>(error)));
            result.Set("sampleRate", Napi::Number::New(env, sample_rate));
            return result;
          }));

  exports.Set("getOptimalNumFrames",
              Napi::Function::New(
                  env, [](const Napi::CallbackInfo &info) -> Napi::Value {
                    Napi::Env env = info.Env();
                    if (!info[0].IsExternal()) {
                      Napi::TypeError::New(env, "Expected model handle")
                          .ThrowAsJavaScriptException();
                      return env.Null();
                    }
                    AicModel *model =
                        info[0].As<Napi::External<AicModel>>().Data();
                    size_t num_frames = 0;
                    AicErrorCode error =
                        aic_get_optimal_num_frames(model, &num_frames);
                    Napi::Object result = Napi::Object::New(env);
                    result.Set("error",
                               Napi::Number::New(env, static_cast<int>(error)));
                    result.Set("numFrames", Napi::Number::New(env, num_frames));
                    return result;
                  }));

  return exports;
}

NODE_API_MODULE(aic_binding, Init)
