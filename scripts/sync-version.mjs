/**
 * Sync APP_VERSION (or argv) into package.json and src-tauri/tauri.conf.json
 * Usage: node scripts/sync-version.mjs [0.1.0]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = (process.argv[2] || process.env.APP_VERSION || '').replace(/^v/, '')
if (!version) {
  console.error('Usage: APP_VERSION=x.y.z node scripts/sync-version.mjs')
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

const confPath = join(root, 'src-tauri/tauri.conf.json')
const conf = JSON.parse(readFileSync(confPath, 'utf8'))
conf.version = version
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n')

console.log(`Synced version ${version} → package.json, tauri.conf.json`)
