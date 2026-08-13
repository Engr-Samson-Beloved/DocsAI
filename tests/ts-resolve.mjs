/**
 * Lets Node's type stripping resolve the project's extensionless relative
 * imports (`./houseStyle`), which bundlers handle but Node's ESM resolver does
 * not. Without this, any test touching a module that imports a sibling fails
 * with ERR_MODULE_NOT_FOUND, and app code would have to be distorted to suit
 * the test runner.
 *
 * Used via: node --import ./tests/ts-resolve.mjs ...
 */
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = ['.ts', '.mts', '.tsx']

registerHooks({
  resolve(specifier, context, nextResolve) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    if (relative && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
      const base = fileURLToPath(new URL(specifier, context.parentURL))
      for (const ext of EXTENSIONS) {
        if (existsSync(base + ext)) return nextResolve(specifier + ext, context)
      }
    }
    return nextResolve(specifier, context)
  },
})
