## New features

- Support for V2 model files, which includes support for the new Quail Voice Focus 2.0 model.

## Improvements

- The parameters of Quail models are no longer fixed. The enhancement level of every model can now be adjusted between 0.0 and 1.0.

## Breaking Changes

- V1 model files are no longer supported.
- The parameter `ProcessorParameter.VoiceGain` was removed.
- The parameter `AIC_VAD_PARAMETER_SPEECH_HOLD_DURATION` previously held detected speech for half of the specified duration. It has now been changed to better represent the intention of the developer.
- The default value for `AIC_VAD_PARAMETER_SPEECH_HOLD_DURATION` was changed from 50 ms to 30 ms to match the existing behavior.

## Fixes

- `aic_vad_context_set_parameter` no longer returns an error when trying to set a valid speech hold duration value before calling `aic_processor_initialize`.
