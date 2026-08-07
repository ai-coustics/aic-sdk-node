const { Model, Processor, ProcessorParameter, getVersion } = require("..");
const fs = require("fs");
const path = require("path");
const WaveFile = require("wavefile").WaveFile;

// Parse command line arguments
const args = process.argv.slice(2);
let inputFile = null;
let outputFile = null;
let modelId = "rook-l-48khz";
let enhancementLevel = 1.0;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--input" || args[i] === "-i") {
    inputFile = args[++i];
  } else if (args[i] === "--output" || args[i] === "-o") {
    outputFile = args[++i];
  } else if (args[i] === "--model" || args[i] === "-m") {
    modelId = args[++i];
  } else if (args[i] === "--enhancement" || args[i] === "-e") {
    enhancementLevel = parseFloat(args[++i]);
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Usage: node file-processing.js --input <file> [options]

Options:
  -i, --input <file>       Input WAV file (required)
  -o, --output <file>      Output WAV file (default: input_enhanced.wav)
  -m, --model <id>         Model ID (default: rook-l-48khz)
  -e, --enhancement <val>  Enhancement level 0.0-1.0 (default: 1.0)
  -h, --help               Show this help

Requires: npm install wavefile
`);
    process.exit(0);
  } else if (!inputFile) {
    inputFile = args[i];
  }
}

if (!inputFile) {
  console.error("Error: Input file is required");
  console.error("Usage: node file-processing.js --input <file>");
  process.exit(1);
}

// Generate default output filename
if (!outputFile) {
  const parsed = path.parse(inputFile);
  outputFile = path.join(parsed.dir, `${parsed.name}_enhanced${parsed.ext}`);
}

// Check for license key
if (!process.env.AIC_SDK_LICENSE) {
  console.error("Error: AIC_SDK_LICENSE environment variable not set");
  console.error("Get your license key from https://developers.ai-coustics.com");
  process.exit(1);
}

console.log("SDK version:", getVersion());
console.log("Input file:", inputFile);
console.log("Output file:", outputFile);

// Read input file
let samples;
let sampleRate;

try {
  const fileBytes = fs.readFileSync(inputFile);
  const wav = new WaveFile(fileBytes);
  sampleRate = wav.fmt.sampleRate;
  const numChannels = wav.fmt.numChannels;

  // Convert to 32-bit float samples (normalized to -1.0 to 1.0)
  wav.toBitDepth("32f");
  const interleaved = wav.getSamples(true, Float32Array);

  // The SDK processes mono audio. Down-mix multi-channel input by averaging channels.
  if (numChannels === 1) {
    samples = interleaved;
  } else {
    const frames = interleaved.length / numChannels;
    samples = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame++) {
      let sum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        sum += interleaved[frame * numChannels + ch];
      }
      samples[frame] = sum / numChannels;
    }
  }

  console.log(
    `Loaded: ${sampleRate}Hz, ${numChannels} channel(s) -> mono, ${samples.length} samples`,
  );
} catch (error) {
  console.error("Failed to read input file:", error.message);
  process.exit(1);
}

// Download and load model
let model;
try {
  console.log("Loading model:", modelId);
  const modelPath = Model.download(modelId, "/tmp/aic-models");
  model = Model.fromFile(modelPath);
  console.log("Model ID:", model.getId());
} catch (error) {
  console.error("Failed to load model:", error.message);
  process.exit(1);
}

// Get the optimal block size for the file's sample rate
const blockSize = model.getOptimalBlockSize(sampleRate);

console.log("Sample rate:", sampleRate);
console.log("Block size:", blockSize, "samples");

// Create processor
let processor;
try {
  processor = new Processor(model, process.env.AIC_SDK_LICENSE);
  processor.initialize(sampleRate, blockSize, false);
} catch (error) {
  console.error("Failed to create processor:", error.message);
  process.exit(1);
}

// Get processor context and the delay applied to the audio
const processorContext = processor.getContext();
const audioDelay = processorContext.getAudioDelay();
console.log("Audio delay:", audioDelay, "samples");

// Set enhancement parameters
try {
  processorContext.setParameter(
    ProcessorParameter.EnhancementLevel,
    enhancementLevel,
  );
  console.log("Enhancement level:", enhancementLevel);
} catch (error) {
  console.error("Warning: Failed to set parameters:", error.message);
}

// Calculate padding and total samples
const paddedLength = samples.length + audioDelay;
const totalBlocks = Math.ceil(paddedLength / blockSize);
const totalPaddedSamples = totalBlocks * blockSize;

console.log("Original samples:", samples.length);
console.log("Padded samples:", totalPaddedSamples);
console.log("Total blocks to process:", totalBlocks);

// Create the padded input signal
const paddedInput = new Float32Array(totalPaddedSamples);

// Copy the original audio into the padded signal
paddedInput.set(samples);
// Remaining samples are already zero (padding at the end to flush the audio delay)

// Allocate storage for the processed output
const processedOutput = new Float32Array(totalPaddedSamples);

// Process one audio block at a time
console.log("Processing...");
const audioBlock = new Float32Array(blockSize);

for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex++) {
  const offset = blockIndex * blockSize;

  // Copy the next block from the padded input
  audioBlock.set(paddedInput.subarray(offset, offset + blockSize));

  // Process the audio block in-place
  try {
    processor.process(audioBlock);
  } catch (error) {
    console.error(`Failed to process block ${blockIndex}:`, error.message);
    process.exit(1);
  }

  // Copy the processed block to the output signal
  processedOutput.set(audioBlock, offset);
}
console.log();

// Remove the audio delay from the beginning
const finalOutput = processedOutput.slice(
  audioDelay,
  audioDelay + samples.length,
);

// Write mono output file
try {
  const outWav = new WaveFile();
  outWav.fromScratch(1, sampleRate, "32f", finalOutput);
  fs.writeFileSync(outputFile, outWav.toBuffer());
  console.log("Output written to:", outputFile);
} catch (error) {
  console.error("Failed to write output file:", error.message);
  process.exit(1);
}

console.log("\nFile processing completed successfully");
