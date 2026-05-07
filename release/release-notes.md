## Improvements

- Increased maximum VAD speech hold duration from 100x to 300x the model's window size.

## Bug Fixes

- Removed zero-padding when the host frame size does not match the model frame size, which caused unexpected behavior for some models.
