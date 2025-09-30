/**
 * Node.js bindings for ai-coustics speech enhancement SDK
 * @packageDocumentation
 */

// Load the native addon
const binding = require('../build/Release/aic_binding.node');

/**
 * Error codes returned by the SDK
 */
export enum ErrorCode {
  /** Operation completed successfully */
  SUCCESS = 0,
  /** Required pointer argument was NULL */
  NULL_POINTER = 1,
  /** License key format is invalid or corrupted */
  LICENSE_INVALID = 2,
  /** License key has expired */
  LICENSE_EXPIRED = 3,
  /** Audio configuration is not supported by the model */
  UNSUPPORTED_AUDIO_CONFIG = 4,
  /** Process was called with a different audio buffer configuration than initialized */
  AUDIO_CONFIG_MISMATCH = 5,
  /** Model must be initialized before this operation */
  NOT_INITIALIZED = 6,
  /** Parameter value is outside acceptable range */
  PARAMETER_OUT_OF_RANGE = 7,
  /** SDK activation failed */
  SDK_ACTIVATION_ERROR = 8,
}

/**
 * Available model types for audio enhancement
 */
export enum ModelType {
  /** Native sample rate: 48 kHz, Native num frames: 480, Processing latency: 30ms */
  QUAIL_L48 = 0,
  /** Native sample rate: 16 kHz, Native num frames: 160, Processing latency: 30ms */
  QUAIL_L16 = 1,
  /** Native sample rate: 8 kHz, Native num frames: 80, Processing latency: 30ms */
  QUAIL_L8 = 2,
  /** Native sample rate: 48 kHz, Native num frames: 480, Processing latency: 30ms */
  QUAIL_S48 = 3,
  /** Native sample rate: 16 kHz, Native num frames: 160, Processing latency: 30ms */
  QUAIL_S16 = 4,
  /** Native sample rate: 8 kHz, Native num frames: 80, Processing latency: 30ms */
  QUAIL_S8 = 5,
  /** Native sample rate: 48 kHz, Native num frames: 480, Processing latency: 10ms */
  QUAIL_XS = 6,
  /** Native sample rate: 48 kHz, Native num frames: 480, Processing latency: 10ms */
  QUAIL_XXS = 7,
}

/**
 * Configurable parameters for audio enhancement
 */
export enum Parameter {
  /**
   * Controls the intensity of speech enhancement processing.
   * Range: 0.0 to 1.0
   * - 0.0: Bypass mode - original signal passes through unchanged
   * - 1.0: Full enhancement - maximum noise reduction
   * Default: 1.0
   */
  ENHANCEMENT_LEVEL = 0,

  /**
   * Compensates for perceived volume reduction after noise removal.
   * Range: 0.1 to 4.0 (linear amplitude multiplier)
   * - 0.1: Significant volume reduction (-20 dB)
   * - 1.0: No gain change (0 dB, default)
   * - 2.0: Double amplitude (+6 dB)
   * - 4.0: Maximum boost (+12 dB)
   * Default: 1.0
   */
  VOICE_GAIN = 1,

  /**
   * Enables/disables a noise gate as a post-processing step.
   * Valid values: 0.0 or 1.0
   * - 0.0: Noise gate disabled
   * - 1.0: Noise gate enabled
   * Default: 0.0
   */
  NOISE_GATE_ENABLE = 2,
}

/**
 * Configuration for model initialization
 */
export interface AudioConfig {
  /** Audio sample rate in Hz (8000 - 192000) */
  sampleRate: number;
  /** Number of audio channels (1 for mono, 2 for stereo, etc.) */
  numChannels: number;
  /** Number of samples per channel in each process call */
  numFrames: number;
}

/**
 * High-level interface for the ai-coustics speech enhancement model
 */
export class Model {
  private handle: any;
  private _isInitialized: boolean = false;

  /**
   * Creates a new audio enhancement model instance
   * @param modelType - The enhancement algorithm variant to use
   * @param licenseKey - Your license key
   * @throws Error if model creation fails
   */
  constructor(modelType: ModelType, licenseKey: string) {
    const result = binding.createModel(modelType, licenseKey);
    if (result.error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to create model: ${this.getErrorMessage(result.error)}`);
    }
    this.handle = result.model;
  }

  /**
   * Configures the model for a specific audio format
   * Must be called before processing any audio
   * @param config - Audio configuration parameters
   * @throws Error if initialization fails
   */
  initialize(config: AudioConfig): void {
    const error = binding.initialize(this.handle, config.sampleRate, config.numChannels, config.numFrames);
    if (error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to initialize model: ${this.getErrorMessage(error)}`);
    }
    this._isInitialized = true;
  }

  /**
   * Clears all internal state and buffers
   * Call this when the audio stream is interrupted
   * @throws Error if reset fails
   */
  reset(): void {
    const error = binding.reset(this.handle);
    if (error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to reset model: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Processes audio with interleaved channel data (in-place)
   * @param audio - Float32Array containing interleaved audio data
   * @param numChannels - Number of channels (must match initialization)
   * @param numFrames - Number of frames (must match initialization)
   * @throws Error if processing fails
   */
  processInterleaved(audio: Float32Array, numChannels: number, numFrames: number): void {
    const error = binding.processInterleaved(this.handle, audio, numChannels, numFrames);
    if (error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to process audio: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Processes audio with separate buffers for each channel (in-place)
   * Maximum of 16 channels
   * @param audio - Array of Float32Array, one per channel
   * @param numChannels - Number of channels (must match initialization)
   * @param numFrames - Number of frames per channel (must match initialization)
   * @throws Error if processing fails
   */
  processPlanar(audio: Float32Array[], numChannels: number, numFrames: number): void {
    const error = binding.processPlanar(this.handle, audio, numChannels, numFrames);
    if (error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to process audio: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Sets a model parameter
   * @param parameter - The parameter to modify
   * @param value - New parameter value
   * @throws Error if setting parameter fails
   */
  setParameter(parameter: Parameter, value: number): void {
    const error = binding.setParameter(this.handle, parameter, value);
    if (error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to set parameter: ${this.getErrorMessage(error)}`);
    }
  }

  /**
   * Gets the current value of a parameter
   * @param parameter - The parameter to query
   * @returns Current parameter value
   * @throws Error if getting parameter fails
   */
  getParameter(parameter: Parameter): number {
    const result = binding.getParameter(this.handle, parameter);
    if (result.error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to get parameter: ${this.getErrorMessage(result.error)}`);
    }
    return result.value;
  }

  /**
   * Returns the total output delay in samples for the current audio configuration
   * @returns Delay in samples
   * @throws Error if getting delay fails
   */
  getOutputDelay(): number {
    const result = binding.getOutputDelay(this.handle);
    if (result.error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to get output delay: ${this.getErrorMessage(result.error)}`);
    }
    return result.delay;
  }

  /**
   * Gets the native sample rate of the selected model
   * @returns Optimal sample rate in Hz
   * @throws Error if getting sample rate fails
   */
  getOptimalSampleRate(): number {
    const result = binding.getOptimalSampleRate(this.handle);
    if (result.error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to get optimal sample rate: ${this.getErrorMessage(result.error)}`);
    }
    return result.sampleRate;
  }

  /**
   * Gets the native number of frames for the selected model
   * @returns Optimal frame count
   * @throws Error if getting frame count fails
   */
  getOptimalNumFrames(): number {
    const result = binding.getOptimalNumFrames(this.handle);
    if (result.error !== ErrorCode.SUCCESS) {
      throw new Error(`Failed to get optimal num frames: ${this.getErrorMessage(result.error)}`);
    }
    return result.numFrames;
  }

  /**
   * Checks if the model has been initialized
   */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Releases all resources associated with the model
   */
  destroy(): void {
    if (this.handle) {
      binding.destroyModel(this.handle);
      this.handle = null;
      this._isInitialized = false;
    }
  }

  private getErrorMessage(errorCode: ErrorCode): string {
    const messages: Record<ErrorCode, string> = {
      [ErrorCode.SUCCESS]: 'Operation completed successfully',
      [ErrorCode.NULL_POINTER]: 'Required pointer argument was NULL',
      [ErrorCode.LICENSE_INVALID]: 'License key format is invalid or corrupted',
      [ErrorCode.LICENSE_EXPIRED]: 'License key has expired',
      [ErrorCode.UNSUPPORTED_AUDIO_CONFIG]: 'Audio configuration is not supported by the model',
      [ErrorCode.AUDIO_CONFIG_MISMATCH]: 'Process was called with a different audio buffer configuration',
      [ErrorCode.NOT_INITIALIZED]: 'Model must be initialized before this operation',
      [ErrorCode.PARAMETER_OUT_OF_RANGE]: 'Parameter value is outside acceptable range',
      [ErrorCode.SDK_ACTIVATION_ERROR]: 'SDK activation failed',
    };
    return messages[errorCode] || `Unknown error code: ${errorCode}`;
  }
}

/**
 * Returns the version of the SDK
 */
export function getSdkVersion(): string {
  return binding.getSdkVersion();
}

// Export for CommonJS compatibility
export default {
  Model,
  ModelType,
  Parameter,
  ErrorCode,
  getSdkVersion,
};
