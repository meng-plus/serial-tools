import { describe, it, expect } from 'vitest'
import {
  findRelativeSpecifiers,
  resolveRelative,
  collectModuleGraph,
  importModuleGraph,
  rewriteRelativeSpecifiers,
  maskComments,
} from './moduleGraph'

describe('moduleGraph 路径', () => {
  it('解析相对路径', () => {
    expect(resolveRelative('main.js', './lib-core.js')).toBe('lib-core.js')
    expect(resolveRelative('lib/a.js', '../core.js')).toBe('core.js')
    expect(resolveRelative('lib/a.js', './b.js')).toBe('lib/b.js')
  })

  it('收集相对 import 说明符', () => {
    const code = `
      import { a } from './lib-core.js'
      export { b } from '../x.js'
      const m = await import('./lazy.js')
    `
    expect(findRelativeSpecifiers(code).sort()).toEqual(['../x.js', './lazy.js', './lib-core.js'])
  })

  it('识别多行 import { ... } from', () => {
    const code = `
import {
  crc16_1021,
  buildRequest,
  prepareFirmwareImage,
} from './lib-core.js'
export default { init() {} }
`
    expect(findRelativeSpecifiers(code)).toEqual(['./lib-core.js'])
  })

  it('忽略注释中的 import ... from 字样（doi-core 文件头）', () => {
    const code = `
/**
 * 主站通过 import { ... } from './lib-core.js' 引用。
 */
export function add(a, b) { return a + b }
`
    expect(findRelativeSpecifiers(code)).toEqual([])
    expect(maskComments(code)).not.toContain("from './lib-core.js'")
    // 改写不得把注释当成自依赖
    expect(() => rewriteRelativeSpecifiers(code, 'lib-core.js', new Map())).not.toThrow()
  })

  it('无相对 import 的模块返回空依赖', () => {
    const code = `
export function crc16() { return 0 }
// example: import { x } from './other.js'
`
    expect(findRelativeSpecifiers(code)).toEqual([])
  })
})

describe('moduleGraph 加载', () => {
  it('collect + Blob 链接后得到默认导出', async () => {
    const files: Record<string, string> = {
      'main.js': `
        import { add } from './math.js'
        export default { run: () => add(2, 3), init() {} }
      `,
      'math.js': `
        export function add(a, b) { return a + b }
      `,
    }
    const graph = await collectModuleGraph('main.js', async rel => {
      const c = files[rel]
      if (c == null) throw new Error('missing ' + rel)
      return c
    })
    expect([...graph.keys()].sort()).toEqual(['main.js', 'math.js'])
    const mod = (await importModuleGraph(graph, 'main.js', 'test/pkg')) as {
      default: { run: () => number; init: () => void }
    }
    expect(mod.default.run()).toBe(5)
    expect(typeof mod.default.init).toBe('function')
  })

  it('多行 import 改写后可加载（DOI 形态）', async () => {
    const files: Record<string, string> = {
      'main.js': `
import {
  add,
  mul,
} from './lib-core.js'
export default { run: () => add(2, mul(3, 4)), init() {} }
`,
      'lib-core.js': `
export function add(a, b) { return a + b }
export function mul(a, b) { return a * b }
`,
    }
    const graph = await collectModuleGraph('main.js', async rel => {
      const c = files[rel]
      if (c == null) throw new Error('missing ' + rel)
      return c
    })
    expect([...graph.keys()].sort()).toEqual(['lib-core.js', 'main.js'])
    const mod = (await importModuleGraph(graph, 'main.js', 'test/doi')) as {
      default: { run: () => number }
    }
    expect(mod.default.run()).toBe(14)
  })
})
