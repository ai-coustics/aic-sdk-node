import fs from 'node:fs'
import path from 'node:path'

import { TEST_DATA_DIR, TEST_MODELS } from './models.js'

type ModelKind = keyof typeof TEST_MODELS

/**
 * Resolves a downloaded model fixture.
 *
 * Fixtures are not committed; `pnpm pretest` fetches them into `__test__/data`.
 */
export function modelPath(kind: ModelKind): string {
  const model = TEST_MODELS[kind]
  const modelPath = path.join(TEST_DATA_DIR, model.filename)

  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `Test ${kind} model (${model.id}) not found at ${modelPath}. ` +
        `Run "node scripts/fetch-test-models.mjs" to download it.`,
    )
  }

  return modelPath
}

/**
 * The license key the SDK needs to construct anything.
 *
 * Fails loudly rather than letting tests fail later with a confusing license error.
 */
export function licenseKey(): string {
  const key = process.env.AIC_SDK_LICENSE
  if (!key) {
    throw new Error('AIC_SDK_LICENSE environment variable must be set to run these tests')
  }
  return key
}
