/**
 * Resolve APP_VERSION / APP_GIT_HASH / APP_BUILD_DATE for Vite define.
 * Release CI sets env; local falls back to package.json + git + today (UTC).
 */
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function pkgVersion() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  return String(pkg.version || '0.0.0')
}

function gitHead() {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'dev'
  }
}

function utcDate() {
  return new Date().toISOString().slice(0, 10)
}

export function resolveBuildInfo() {
  const version = (process.env.APP_VERSION || pkgVersion()).replace(/^v/, '')
  const gitHash = process.env.APP_GIT_HASH || gitHead()
  const buildDate = process.env.APP_BUILD_DATE || utcDate()
  return { version, gitHash, buildDate }
}
