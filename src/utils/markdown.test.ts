import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('渲染标题与段落', () => {
    const html = renderMarkdown('# 标题\n\n正文第一行\n第二行')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<p>正文第一行 第二行</p>')
  })

  it('渲染代码块并转义 HTML', () => {
    const html = renderMarkdown('```js\nconst a = 1 < 2\n```')
    expect(html).toContain('<pre><code class="language-js">const a = 1 &lt; 2</code></pre>')
  })

  it('渲染行内 code 与粗斜体', () => {
    const html = renderMarkdown('使用 `ctx.sendHex` 发送，**重要** 与 *强调*')
    expect(html).toContain('<code>ctx.sendHex</code>')
    expect(html).toContain('<strong>重要</strong>')
    expect(html).toContain('<em>强调</em>')
  })

  it('渲染无序/有序列表', () => {
    const html = renderMarkdown('- 甲\n- 乙\n\n1. 一\n2. 二')
    expect(html).toContain('<ul><li>甲</li><li>乙</li></ul>')
    expect(html).toContain('<ol><li>一</li><li>二</li></ol>')
  })

  it('渲染引用与水平线', () => {
    const html = renderMarkdown('> 引用内容\n\n---')
    expect(html).toContain('<blockquote>引用内容</blockquote>')
    expect(html).toContain('<hr>')
  })

  it('渲染表格', () => {
    const md = '| 名称 | 值 |\n| --- | --- |\n| A | 1 |\n| B | 2 |'
    const html = renderMarkdown(md)
    expect(html).toContain('<table>')
    expect(html).toContain('<thead><tr><th>名称</th><th>值</th></tr></thead>')
    expect(html).toContain('<td>A</td>')
    expect(html).toContain('<td>2</td>')
  })

  it('不注入原生 HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1))')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })
})
