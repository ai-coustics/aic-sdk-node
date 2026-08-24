import { fileURLToPath } from 'node:url'
import path from 'node:path'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

/** Where `scripts/fetch-test-models.mjs` puts the downloaded fixtures. */
export const TEST_DATA_DIR = path.join(currentDir, 'data')

export interface TestModel {
  /** Model id as listed in the manifest. */
  id: string
  /** File name the fixture is downloaded to. */
  filename: string
  /** Direct download URL for the fixture. */
  url: string
}

/**
 * Model fixtures the end-to-end tests run against.
 *
 * The model file format version is tied to the SDK version, so these live under a `v7`
 * path segment rather than being committed. Bump the `v7` segments together with the
 * `aic-sdk` dependency, and resolve new URLs through
 * https://artifacts.ai-coustics.io/manifest.json. `getCompatibleModelVersion()` reports
 * the version the built addon expects, and `sdk exposes compatible model version` asserts
 * these fixtures still match it.
 */
export const TEST_MODELS = {
  enhancement: {
    id: 'quail-vf-2.2-s-16khz',
    filename: 'quail_vf_2_2_s_16khz_gf70x7zf_v14.aicmodel',
    url: 'https://artifacts.ai-coustics.io/models/quail-vf-2-2-s-16khz/v7/quail_vf_2_2_s_16khz_gf70x7zf_v14.aicmodel',
  },
  vad: {
    id: 'vad-2.1-xxs-16khz',
    filename: 'vad_2_1_xxs_16khz_mw7jdprk_v36.aicmodel',
    url: 'https://artifacts.ai-coustics.io/models/vad-2-1-xxs-16khz/v7/vad_2_1_xxs_16khz_mw7jdprk_v36.aicmodel',
  },
  analysis: {
    id: 'tyto-1.1-l-16khz',
    filename: 'tyto_1_1_l_16khz_t7y7v3h5_v58.aicmodel',
    url: 'https://artifacts.ai-coustics.io/models/tyto-1-1-l-16khz/v7/tyto_1_1_l_16khz_t7y7v3h5_v58.aicmodel',
  },
} satisfies Record<string, TestModel>

/** The model file format version the fixtures above are published under. */
export const TEST_MODEL_VERSION = 7
