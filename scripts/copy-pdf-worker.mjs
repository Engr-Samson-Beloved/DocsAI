// Copies the pdf.js worker out of node_modules into /public so the served worker is
// always the same release as the bundled pdfjs-dist API. Runs on install and before
// dev/build; a version mismatch here is what produces pdf.js's
// "The API version 'x' does not match the worker version 'y'" error at import time.

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = join(root, 'node_modules', 'pdfjs-dist')
const source = join(pkgDir, 'legacy', 'build', 'pdf.worker.min.mjs')
const publicDir = join(root, 'public')
const target = join(publicDir, 'pdf.worker.min.mjs')

if (!existsSync(source)) {
  console.warn('[copy-pdf-worker] pdfjs-dist not installed yet; skipping.')
  process.exit(0)
}

if (!existsSync(publicDir)) mkdirSync(publicDir, { recursive: true })
copyFileSync(source, target)

const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
console.log(`[copy-pdf-worker] public/pdf.worker.min.mjs synced to pdfjs-dist@${version}`)
