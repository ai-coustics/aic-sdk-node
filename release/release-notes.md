# Release Notes

## New features

- Added new Quail Voice Focus STT model (`QuailVfSttL16`), purpose-built to isolate and elevate the foreground speaker while suppressing both interfering speech and background noise.
- Added new variants of the Quail STT model: `QuailSttL8`, `QuailSttS16` and `QuailSttS8`.
- Added new VAD parameter `VadParameter.MinimumSpeechDuration` used to control for how long speech needs to be present in the audio signal before the VAD considers it speech.

## Breaking changes

- `QuailXS` was renamed to `QuailXs`
- `QuailXXS` was renamed to `QuailXxs`
- `QuailSTT` was replaced with specific STT model variants: `QuailSttL16`, `QuailSttL8`, `QuailSttS16`, `QuailSttS8`
- Replaced VAD parameter `VadParameter.LookbackBufferSize` with `VadParameter.SpeechHoldDuration`, used to control for how long the VAD continues to detect speech after the audio signal no longer contains speech.

## Fixes

- VAD now works correctly when `EnhancementParameter.EnhancementLevel` is set to 0 or `EnhancementParameter.Bypass` is enabled (previously non-functional in these cases)
