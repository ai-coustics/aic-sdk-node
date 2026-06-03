## Features

- Added JWT bearer token refresh via `ProcessorContext.updateBearerToken`. When the processor was created with a JWT license, this swaps in a renewed token while audio processing continues uninterrupted. If either the originally configured key or the new token is not a JWT, an error is thrown and the existing token stays in use.
- `VadParameter.Sensitivity` is now also supported on dedicated VAD models (e.g. Quail VAD), where the value is interpreted as the speech probability threshold in the range 0.0 to 1.0. Energy-based VADs continue to use the existing 1.0 to 15.0 range. The default is now model-specific.
- Added `OtelConfig.exportIntervalMs` to control how often OpenTelemetry metrics are exported. Set to 0 to keep the SDK default of 60000 ms.
- Added `OtelConfig` for per-processor OpenTelemetry control. Pass an instance as the third argument to `Processor` to override the `AIC_SDK_OTEL_ENABLE` environment setting for that processor only. Use `OtelConfig.enabled()`, `OtelConfig.disabled()`, or `OtelConfig.withSessionId(sessionId)` to construct one.
