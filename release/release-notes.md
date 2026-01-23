
### Improvements

- Increased the maximum speech hold duration of the VAD from 20 to 100x the model's window size.

### Fixes

- Fixed an issue causing the VAD's state to be reset on every `process*` call.
