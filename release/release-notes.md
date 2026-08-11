This release updates the underlying ai-coustics SDK to 0.23.0.

### Breaking Changes

#### New model file version

This release requires model file version 7. Re-download your models so the SDK does not reject them
with a "model version is not supported" error. See the
[compatibility matrix](https://docs.ai-coustics.com/reference/sdk/compatibility-matrix).

```javascript
const { Model, getCompatibleModelVersion } = require("@ai-coustics/aic-sdk");

// Reports the model file version this SDK build expects.
console.log(getCompatibleModelVersion()); // 7

// Re-download the models your integration uses.
const modelPath = Model.download("quail-vf-2.2-s-16khz", "./models");
```

### New Features

#### Tyto 1.0 has been replaced by Tyto 1.1

The analysis model is now Tyto 1.1, `tyto-1.1-l-16khz`. Tyto 1.0 (`tyto-l-16khz`) is not loadable by
this SDK version any more.

Before:

```javascript
const modelPath = Model.download("tyto-l-16khz", "./models");
```

After:

```javascript
const modelPath = Model.download("tyto-1.1-l-16khz", "./models");
```

#### Analysis result fields changed

The `AnalysisResult` objects returned by `FileAnalyzer.analyze()` and `Analyzer.analyzeBuffered()`
gained a field and lost one:

- Added: `codecDegradation`, a measure of artifacts introduced by lossy speech codecs. Like the
  other fields it ranges from 0.0 to 1.0, and lower values indicate less problematic audio.
- Removed: `mediaSpeech`.

### Bug Fixes

- `Analyzer.analyzeBuffered()` no longer crashes when OpenTelemetry reporting is enabled.
