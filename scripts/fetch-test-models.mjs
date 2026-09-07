/**
 * Downloads the `.aicmodel` fixtures the end-to-end tests need, via the SDK's own
 * `Model.download()`. Requires a built addon, so run `pnpm build` first (CI downloads
 * the `.node` artifact before `pnpm test`).
 *
 * The manifest is re-fetched on every call, so the newest compatible model version is
 * always used. Files that already exist with a matching checksum are left untouched.
 *
 * `Model.download()` picks the filename from the manifest (build hash + version), so the
 * resolved paths are written to `paths.json` for `modelPath()` to read back at test time.
 */
import fs from 'node:fs'
import path from 'node:path'

import { Model } from '../index.js'
import { TEST_DATA_DIR, TEST_MODELS } from '../__test__/models.ts'

async function main() {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true })

  const paths = {}
  for (const [kind, model] of Object.entries(TEST_MODELS)) {
    console.log(`Downloading ${model.id}`)
    paths[kind] = await Model.download(model.id, TEST_DATA_DIR)
  }

  fs.writeFileSync(path.join(TEST_DATA_DIR, 'paths.json'), JSON.stringify(paths, null, 2))
}

main().catch((error) => {
  console.error(`Failed to fetch test models: ${error.message}`)
  process.exit(1)
})
