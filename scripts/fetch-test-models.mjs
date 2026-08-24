/**
 * Downloads the `.aicmodel` fixtures the end-to-end tests need.
 *
 * The model file format version is tied to the SDK version (see
 * `getCompatibleModelVersion()`), so models are pulled from the matching version directory
 * on artifacts.ai-coustics.io rather than committed to this repository. Files that already
 * exist are left untouched.
 */
import fs from 'node:fs'
import path from 'node:path'

import { TEST_DATA_DIR, TEST_MODELS } from '../__test__/models.ts'

async function download(url, destination) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status} ${response.statusText}`)
  }

  // Write to a temporary file first, so an interrupted download cannot leave a truncated
  // model behind that later runs would happily reuse.
  const temporary = `${destination}.part`
  fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()))
  fs.renameSync(temporary, destination)
}

async function main() {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true })

  for (const model of Object.values(TEST_MODELS)) {
    const destination = path.join(TEST_DATA_DIR, model.filename)

    if (fs.existsSync(destination)) {
      console.log(`${model.filename} already present, skipping`)
      continue
    }

    console.log(`Downloading ${model.id} -> ${model.filename}`)
    await download(model.url, destination)
  }
}

main().catch((error) => {
  console.error(`Failed to fetch test models: ${error.message}`)
  process.exit(1)
})
