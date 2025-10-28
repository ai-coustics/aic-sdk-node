#include "../sdk/include/aic.h"
#include <napi.h>
#include <string>
#include <vector>

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

  // Standalone functions for model operations
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
            bool variable_frames = info[4].As<Napi::Boolean>().Value();
            AicErrorCode error = aic_model_initialize(model, sample_rate,
                                                      num_channels, num_frames, variable_frames);
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
