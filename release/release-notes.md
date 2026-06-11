### New Features

This release includes several new APIs for running our newest audio intelligence model, *Tyto*.

Analysis models score audio quality instead of enhancing it. Each result reports a headline
`riskScore` alongside individual measures for speaker reverb, speaker loudness, interfering
speech, media speech, noise and packet loss.

The new APIs introduce two new concepts: the `Collector` and the `Analyzer`, created together
with `analyzerPair`.
 - The `Collector` is designed to be placed in the audio thread, buffering audio chunks for later analysis.
 - The `Analyzer` is designed to be run separately. Analysis models are computationally expensive and cannot run in the audio thread. The analyzer has access to the audio buffered by the collector, and it can access it safely across threads.

Initialize the `Collector` with the same configuration as your existing `Processor` and you can
call the `collector.buffer*` methods in the same manner as the `processor.process*` methods.

Call `analyzer.analyzeBuffered()` separately to obtain an analysis of the latest audio buffered
by the `Collector`.

For audio that is already loaded in memory, the `FileAnalyzer` convenience wrapper analyzes
complete mono buffers in fixed five-second windows, so you do not have to manage a
collector/analyzer pair yourself.
