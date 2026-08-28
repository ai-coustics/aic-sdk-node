import fs from 'node:fs'
import path from 'node:path'

import { TEST_DATA_DIR, TEST_MODELS } from './models.js'

type ModelKind = keyof typeof TEST_MODELS

/**
 * Resolves a downloaded model fixture.
 *
 * Fixtures are not committed; `pnpm pretest` fetches them into `__test__/data` via
 * `Model.download()` and records the resolved paths in `paths.json`.
 */
export function modelPath(kind: ModelKind): string {
  const sidecar = path.join(TEST_DATA_DIR, 'paths.json')
  if (!fs.existsSync(sidecar)) {
    throw new Error(`Test models not downloaded. Run "pnpm build" then "pnpm pretest" to fetch them.`)
  }

  const paths = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as Record<string, string>
  const resolved = paths[kind]
  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(`Test ${kind} model not found. Run "pnpm pretest" to download it.`)
  }

  return resolved
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
