import { fileURLToPath } from 'node:url'
import path from 'node:path'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

/** Where `scripts/fetch-test-models.mjs` puts the downloaded fixtures. */
export const TEST_DATA_DIR = path.join(currentDir, 'data')

export interface TestModel {
  /** Model id as listed in the manifest. */
  id: string
}

/**
 * Model fixtures the end-to-end tests run against.
 *
 * `scripts/fetch-test-models.mjs` resolves these through `Model.download()`, which
 * re-fetches the manifest and pulls the newest compatible model version. The model file
 * format version is tied to the SDK version, so `getCompatibleModelVersion()` reports
 * the version the built addon expects, and the `sdk expects the model version the
 * fixtures are published under` test asserts the fixtures still match it.
 */
export const TEST_MODELS = {
  enhancement: { id: 'quail-vf-2.2-s-16khz' },
  vad: { id: 'vad-2.1-xxs-16khz' },
  analysis: { id: 'tyto-1.1-l-16khz' },
} satisfies Record<string, TestModel>

/** The model file format version the built addon expects. */
export const TEST_MODEL_VERSION = 7
