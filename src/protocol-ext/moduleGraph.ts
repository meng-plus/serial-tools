/** 协议包 ESM 模块图：收集相对 import，经 Blob URL 链接后动态 import */

/**
 * 将 // 与 /* *\/ 注释替换为空格（保留换行与字符串），避免注释里的
 * `import ... from './x.js'` 被当成真实依赖（doi-core 文件头即中招）。
 */
export function maskComments(code: string): string {
  const out: string[] = []
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch
      out.push(q)
      i++
      while (i < code.length) {
        if (code[i] === '\\') {
          out.push(code[i], code[i + 1] ?? '')
          i += 2
          continue
        }
        out.push(code[i])
        if (code[i] === q) {
          i++
          break
        }
        i++
      }
      continue
    }
    if (ch === '/' && code[i + 1] === '/') {
      out.push('  ')
      i += 2
      while (i < code.length && code[i] !== '\n') {
        out.push(' ')
        i++
      }
      continue
    }
    if (ch === '/' && code[i + 1] === '*') {
      out.push('  ')
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        out.push(code[i] === '\n' ? '\n' : ' ')
        i++
      }
      if (i < code.length) {
        out.push('  ')
        i += 2
      }
      continue
    }
    out.push(ch)
    i++
  }
  return out.join('')
}

const STATIC_IMPORT_RE =
  /((?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?)(['"])(\.[^'"]+)\2/g
const DYNAMIC_IMPORT_RE = /import\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g

/**
 * 静态 import/export-from（含多行 `import {\n  a\n} from './x.js'`）
 * 与动态 import() 中的相对路径。
 * 注意：不可用 [^'"\n]，否则 DOI 这类多行 import 扫不到 from，Blob 下会报
 * “Invalid relative url or base scheme isn't hierarchical”。
 */
export function findRelativeSpecifiers(code: string): string[] {
  const masked = maskComments(code)
  const out = new Set<string>()
  const staticRe =
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"](\.[^'"]+)['"]/g
  const dynRe = /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g
  for (const re of [staticRe, dynRe]) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(masked))) out.add(m[1])
  }
  return [...out]
}

/** 将代码中的相对 import/export 说明符改写为绝对 URL（依赖须已在 urlOf 中） */
export function rewriteRelativeSpecifiers(
  code: string,
  fromRel: string,
  urlOf: Map<string, string>,
): string {
  const masked = maskComments(code)
  type Rep = { start: number; end: number; text: string }
  const reps: Rep[] = []

  STATIC_IMPORT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = STATIC_IMPORT_RE.exec(masked))) {
    const prefix = m[1]
    const q = m[2]
    const spec = m[3]
    const dep = resolveRelative(fromRel, spec)
    const u = urlOf.get(dep)
    if (!u) throw new Error(`模块 ${fromRel} 依赖 ${dep} 尚未链接（是否存在循环依赖？）`)
    const specStart = m.index + prefix.length
    reps.push({
      start: specStart,
      end: specStart + q.length + spec.length + q.length,
      text: `${q}${u}${q}`,
    })
  }

  DYNAMIC_IMPORT_RE.lastIndex = 0
  while ((m = DYNAMIC_IMPORT_RE.exec(masked))) {
    const q = m[1]
    const spec = m[2]
    const dep = resolveRelative(fromRel, spec)
    const u = urlOf.get(dep)
    if (!u) throw new Error(`动态 import 依赖 ${dep} 尚未链接`)
    // `import('...')` → 引号起于 import( 之后
    const specStart = m.index + m[0].indexOf(q)
    reps.push({
      start: specStart,
      end: specStart + q.length + spec.length + q.length,
      text: `${q}${u}${q}`,
    })
  }

  reps.sort((a, b) => b.start - a.start)
  let next = code
  for (const r of reps) {
    next = next.slice(0, r.start) + r.text + next.slice(r.end)
  }
  return next
}

/** 相对路径解析（posix 风格，包内路径不含前导 ./） */
export function resolveRelative(fromRel: string, spec: string): string {
  const fromDir = fromRel.includes('/') ? fromRel.slice(0, fromRel.lastIndexOf('/') + 1) : ''
  const joined = fromDir + spec
  const parts = joined.split('/')
  const stack: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') {
      if (stack.length) stack.pop()
      continue
    }
    stack.push(p)
  }
  return stack.join('/')
}

export async function collectModuleGraph(
  entry: string,
  readText: (rel: string) => Promise<string>,
): Promise<Map<string, string>> {
  const entryNorm = entry.replace(/^\.\//, '')
  const sources = new Map<string, string>()
  const queue = [entryNorm]
  while (queue.length) {
    const rel = queue.pop()!
    if (sources.has(rel)) continue
    const code = await readText(rel)
    sources.set(rel, code)
    for (const spec of findRelativeSpecifiers(code)) {
      const next = resolveRelative(rel, spec)
      if (!sources.has(next)) queue.push(next)
    }
  }
  return sources
}

function moduleDepth(sources: Map<string, string>, rel: string, visiting: Set<string>, memo: Map<string, number>): number {
  if (memo.has(rel)) return memo.get(rel)!
  if (visiting.has(rel)) return 0
  visiting.add(rel)
  const code = sources.get(rel) || ''
  let d = 0
  for (const spec of findRelativeSpecifiers(code)) {
    const dep = resolveRelative(rel, spec)
    d = Math.max(d, 1 + moduleDepth(sources, dep, visiting, memo))
  }
  visiting.delete(rel)
  memo.set(rel, d)
  return d
}

function toRevocableModuleUrl(code: string): { url: string; revoke: () => void } {
  // 浏览器 / Tauri WebView：Blob URL；Node/Vitest：data URL（Vite 对 blob: 无法解析）
  if (typeof window !== 'undefined' && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    return { url, revoke: () => URL.revokeObjectURL(url) }
  }
  const url = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(code)
  return { url, revoke: () => {} }
}

/**
 * 将相对 import 改写为绝对模块 URL 并 import 入口。
 * 依赖按深度升序链接（叶子先）。
 */
export async function importModuleGraph(
  sources: Map<string, string>,
  entry: string,
  sourceURLPrefix: string,
): Promise<unknown> {
  const entryNorm = entry.replace(/^\.\//, '')
  if (!sources.has(entryNorm)) throw new Error(`模块图缺少入口 ${entryNorm}`)

  const memo = new Map<string, number>()
  const visiting = new Set<string>()
  for (const rel of sources.keys()) moduleDepth(sources, rel, visiting, memo)
  const order = [...sources.keys()].sort((a, b) => (memo.get(a) || 0) - (memo.get(b) || 0))

  const urlOf = new Map<string, string>()
  const revokers: Array<() => void> = []

  try {
    for (const rel of order) {
      let code = rewriteRelativeSpecifiers(sources.get(rel)!, rel, urlOf)
      code += `\n//# sourceURL=${sourceURLPrefix}/${rel}`
      const { url, revoke } = toRevocableModuleUrl(code)
      urlOf.set(rel, url)
      revokers.push(revoke)
    }

    const entryUrl = urlOf.get(entryNorm)!
    return await import(/* @vite-ignore */ entryUrl)
  } finally {
    // 延迟 revoke：部分 WebView 在 import 微任务内仍会二次解析模块图
    const list = [...revokers]
    setTimeout(() => {
      for (const revoke of list) revoke()
    }, 0)
  }
}
