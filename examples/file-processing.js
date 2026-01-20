const { Model, Processor, ProcessorParameter, getVersion } = require("..");
const fs = require("fs");
const path = require("path");
const WaveFile = require("wavefile").WaveFile;

// Parse command line arguments
const args = process.argv.slice(2);
let inputFile = null;
let outputFile = null;
let modelId = "sparrow-l-48khz";
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
  -m, --model <id>         Model ID (default: sparrow-l-48khz)
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
  console.error("Get your license key from https://developers.ai-coustics.io");
  process.exit(1);
}

console.log("SDK Version:", getVersion());
console.log("Input file:", inputFile);
console.log("Output file:", outputFile);

// Read input file
let wav;
let samples;
let sampleRate;
let numChannels;

try {
  const buffer = fs.readFileSync(inputFile);
  wav = new WaveFile(buffer);
  sampleRate = wav.fmt.sampleRate;
  numChannels = wav.fmt.numChannels;

  // Convert to 32-bit float samples (normalized to -1.0 to 1.0)
  wav.toBitDepth("32f");
  const rawSamples = wav.getSamples(true, Float32Array);

  // getSamples with interleave=true returns interleaved samples
  samples = rawSamples;

  const samplesPerChannel = samples.length / numChannels;
  console.log(
    `Loaded: ${sampleRate}Hz, ${numChannels} channels, ${samplesPerChannel} samples`,
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

// Get optimal num frames for the file's sample rate
const numFrames = model.getOptimalNumFrames(sampleRate);

console.log("Sample Rate:", sampleRate);
console.log("Chunk Size:", numFrames, "samples");

// Create processor
let processor;
try {
  processor = new Processor(model, process.env.AIC_SDK_LICENSE);
  processor.initialize(sampleRate, numChannels, numFrames, false);
} catch (error) {
  console.error("Failed to create processor:", error.message);
  process.exit(1);
}

// Get processor context and output delay
const processorContext = processor.getProcessorContext();
const outputDelay = processorContext.getOutputDelay();
console.log("Output Delay:", outputDelay, "samples");

// Set enhancement parameters
try {
  processorContext.setParameter(
    ProcessorParameter.EnhancementLevel,
    enhancementLevel,
  );
  console.log("Enhancement Level:", enhancementLevel);
} catch (error) {
  console.error("Warning: Failed to set parameters:", error.message);
}

// Calculate padding and total samples
const samplesPerChannel = samples.length / numChannels;
const paddedLength = samplesPerChannel + outputDelay;
const totalChunks = Math.ceil(paddedLength / numFrames);
const totalPaddedSamples = totalChunks * numFrames;

console.log("Original samples per channel:", samplesPerChannel);
console.log("Padded samples per channel:", totalPaddedSamples);
console.log("Total chunks to process:", totalChunks);

// Create padded input buffer (interleaved format)
const paddedInput = new Float32Array(totalPaddedSamples * numChannels);

// Copy original audio to padded buffer
paddedInput.set(samples);
// Remaining samples are already zero (padding at the end to flush output delay)

// Create output buffer
const outputBuffer = new Float32Array(totalPaddedSamples * numChannels);

// Process in chunks
console.log("Processing...");
const chunkBuffer = new Float32Array(numFrames * numChannels);

for (let chunk = 0; chunk < totalChunks; chunk++) {
  const inputOffset = chunk * numFrames * numChannels;
  const outputOffset = chunk * numFrames * numChannels;

  // Copy chunk from padded input
  for (let i = 0; i < chunkBuffer.length; i++) {
    chunkBuffer[i] = paddedInput[inputOffset + i] || 0;
  }

  // Process chunk (in-place)
  try {
    processor.processInterleaved(chunkBuffer);
  } catch (error) {
    console.error(`Failed to process chunk ${chunk}:`, error.message);
    process.exit(1);
  }

  // Copy processed chunk to output
  outputBuffer.set(chunkBuffer, outputOffset);

  // Progress indicator
  if ((chunk + 1) % 10 === 0 || chunk === totalChunks - 1) {
    const progress = Math.round(((chunk + 1) / totalChunks) * 100);
    process.stdout.write(`\rProcessing... ${progress}%`);
  }
}
console.log();

// Remove output delay from the beginning
const delayOffset = outputDelay * numChannels;
const finalLength = samplesPerChannel * numChannels;
const finalOutput = outputBuffer.slice(delayOffset, delayOffset + finalLength);

// Write output file
try {
  const outWav = new WaveFile();

  // Create WAV with interleaved samples
  // fromScratch expects: numChannels, sampleRate, bitDepth, samples
  // For interleaved data with multiple channels, we need to deinterleave
  if (numChannels === 1) {
    outWav.fromScratch(1, sampleRate, "32f", finalOutput);
  } else {
    // Deinterleave for multi-channel output
    const channelData = [];
    for (let ch = 0; ch < numChannels; ch++) {
      const channelSamples = new Float32Array(samplesPerChannel);
      for (let i = 0; i < samplesPerChannel; i++) {
        channelSamples[i] = finalOutput[i * numChannels + ch];
      }
      channelData.push(channelSamples);
    }
    outWav.fromScratch(numChannels, sampleRate, "32f", channelData);
  }

  fs.writeFileSync(outputFile, outWav.toBuffer());
  console.log("Output written to:", outputFile);
} catch (error) {
  console.error("Failed to write output file:", error.message);
  process.exit(1);
}

console.log("\nFile processing completed successfully");
