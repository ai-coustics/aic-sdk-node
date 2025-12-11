# Release Notes

## New features

- Added new Quail Voice Focus STT model (`QuailVfSttL16`), purpose-built to isolate and elevate the foreground speaker while suppressing both interfering speech and background noise.
- Added new variants of the Quail STT model: `QuailSttL8`, `QuailSttS16` and `QuailSttS8`.

## Breaking changes

- `QuailXS` was renamed to `QuailXs`
- `QuailXXS` was renamed to `QuailXxs`
- `QuailSTT` was replaced with specific STT model variants: `QuailSttL16`, `QuailSttL8`, `QuailSttS16`, `QuailSttS8`

## Fixes

- VAD now works correctly when `EnhancementParameter.EnhancementLevel` is set to 0 or `EnhancementParameter.Bypass` is enabled (previously non-functional in these cases)
