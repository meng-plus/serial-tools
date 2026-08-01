/**
 * Collect Tauri bundle outputs + portable binary into release-assets/:
 *   serial-tools-{VERSION}-{OS}-{ARCH}[-setup|-portable].{EXT}
 *
 * Usage: node scripts/rename-release-assets.mjs <version> <windows|linux> [bundleRoot]
 */
import { readdirSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const version = (process.argv[2] || '').replace(/^v/, '')
const os = process.argv[3]
const outDir = join('release-assets')

if (!version || !['windows', 'linux'].includes(os)) {
  console.error('Usage: node scripts/rename-release-assets.mjs <version> <windows|linux> [bundleRoot]')
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name)
    if (name.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

/** Cargo workspace 产物在仓库根 target/；非 workspace 偶发在 src-tauri/target/ */
function resolveBundleRoot() {
  if (process.argv[4]) return process.argv[4]
  const candidates = [
    join('target', 'release', 'bundle'),
    join('src-tauri', 'target', 'release', 'bundle'),
  ]
  for (const c of candidates) {
    if (existsSync(c) && walk(c).length > 0) return c
  }
  return candidates[0]
}

function resolveReleaseDir() {
  const candidates = [join('target', 'release'), join('src-tauri', 'target', 'release')]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return candidates[0]
}

const bundleRoot = resolveBundleRoot()
const releaseDir = resolveReleaseDir()
const files = walk(bundleRoot)
const copied = []

function copyAs(src, destName) {
  if (!src || !existsSync(src)) return false
  const dest = join(outDir, destName)
  copyFileSync(src, dest)
  copied.push(destName)
  console.log(`${src} → ${destName}`)
  return true
}

function findPortableBinary() {
  const names =
    os === 'windows'
      ? ['serial-tools.exe', 'Serial Tools.exe']
      : ['serial-tools']
  for (const name of names) {
    const p = join(releaseDir, name)
    if (existsSync(p)) return p
  }
  return null
}

if (os === 'windows') {
  const arch = 'x64'
  // 免安装：与本地 npm run build:app 后直接运行的主程序相同
  const portable = findPortableBinary()
  if (!copyAs(portable, `serial-tools-${version}-windows-${arch}-portable.exe`)) {
    console.warn('WARN: portable exe not found under', releaseDir)
  }

  const setup = files.find(
    f => /setup\.exe$/i.test(f) || (/[\\/]nsis[\\/]/i.test(f) && f.endsWith('.exe')),
  )
  const msi = files.find(f => f.toLowerCase().endsWith('.msi'))
  copyAs(setup, `serial-tools-${version}-windows-${arch}-setup.exe`)
  copyAs(msi, `serial-tools-${version}-windows-${arch}.msi`)
} else {
  const arch = 'amd64'
  // AppImage 本身即为免安装；再附 raw 二进制便于调试
  const portable = findPortableBinary()
  copyAs(portable, `serial-tools-${version}-linux-${arch}-portable`)

  const deb = files.find(f => f.endsWith('.deb'))
  const appimage = files.find(f => f.endsWith('.AppImage'))
  copyAs(deb, `serial-tools-${version}-linux-${arch}.deb`)
  copyAs(appimage, `serial-tools-${version}-linux-${arch}.AppImage`)
}

if (copied.length === 0) {
  console.error('No artifacts found. bundleRoot=', bundleRoot, 'releaseDir=', releaseDir)
  console.error('Bundle files:', files)
  process.exit(1)
}

console.log(`Collected ${copied.length} asset(s)`)
