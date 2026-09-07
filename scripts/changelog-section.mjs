import { readFileSync } from 'node:fs'

const version = process.argv[2]

if (!version) {
  console.error('usage: changelog-section.mjs <version>')
  process.exit(1)
}

const lines = readFileSync('CHANGELOG.md', 'utf8').split('\n')
const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `))

if (start === -1) {
  console.error(`CHANGELOG.md has no section for ${version}`)
  process.exit(1)
}

const rest = lines.slice(start + 1)
const end = rest.findIndex((line) => line.startsWith('## '))
const body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()

if (!body) {
  console.error(`The CHANGELOG.md section for ${version} is empty`)
  process.exit(1)
}

process.stdout.write(`${body}\n`)
