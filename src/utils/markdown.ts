/**
 * 轻量 Markdown → 安全 HTML 渲染器（协议包 README 展示用）。
 *
 * 支持：ATX 标题、段落、代码块（```）、行内 code、加粗/斜体、
 *       无序/有序列表、引用、水平线、表格。默认转义 HTML，无 XSS 注入风险。
 *
 * 纯函数、零依赖（不拉入 marked/DOMPurify 等），可直接被 vitest 覆盖。
 */

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 行内解析：先整体转义 HTML，再处理行内 code，再处理粗体/斜体 */
function inline(text: string): string {
  const escaped = escHtml(text)
  const parts = escaped.split(/(`[^`]+`)/g)
  return parts
    .map(seg => {
      if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 1) {
        return `<code>${seg.slice(1, -1)}</code>`
      }
      return seg
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/(^|[^A-Za-z0-9])_([^_]+)_/g, '$1<em>$2</em>')
    })
    .join('')
}

type BlockKind = 'heading' | 'hr' | 'quote' | 'ul' | 'ol' | 'table' | 'paragraphStart'

function classify(line: string): BlockKind {
  const t = line.trim()
  if (/^(#{1,6})\s+/.test(t)) return 'heading'
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) return 'hr'
  if (t.startsWith('>')) return 'quote'
  if (/^\s*[-*+]\s+/.test(line)) return 'ul'
  if (/^\s*\d+\.\s+/.test(line)) return 'ol'
  if (/^\s*\|.*\|\s*$/.test(t)) return 'table'
  return 'paragraphStart'
}

/** 渲染 Markdown 文本为安全的 HTML 字符串 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const kind = classify(line)

    if (/^(```|~~~)/.test(line.trim())) {
      const first = line.trim()
      const lang = first.slice(3).trim()
      i++
      const buf: string[] = []
      while (i < lines.length && !/^(```|~~~)/.test(lines[i].trim())) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过结束栅栏
      out.push(`<pre><code${lang ? ` class="language-${escHtml(lang)}"` : ''}>${escHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    if (kind === 'heading') {
      const m = line.trim().match(/^(#{1,6})\s+(.*)$/) as RegExpMatchArray
      const lvl = m[1].length
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`)
      i++
      continue
    }

    if (kind === 'hr') {
      out.push('<hr>')
      i++
      continue
    }

    if (kind === 'quote') {
      const buf: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${buf.map(x => inline(x)).join('<br>')}</blockquote>`)
      continue
    }

    if (kind === 'ul') {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      out.push(`<ul>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ul>`)
      continue
    }

    if (kind === 'ol') {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      out.push(`<ol>${items.map(x => `<li>${inline(x)}</li>`).join('')}</ol>`)
      continue
    }

    if (kind === 'table') {
      // 校验下一行为分隔行（| --- |），否则按段落处理
      if (i + 1 >= lines.length || !/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1].trim()) || !lines[i + 1].includes('-')) {
        const buf: string[] = [line.trim()]
        i++
        while (i < lines.length && classify(lines[i]) === 'paragraphStart') {
          buf.push(lines[i].trim())
          i++
        }
        out.push(`<p>${inline(buf.join(' '))}</p>`)
        continue
      }
      const trimCell = (cell: string) => cell.replace(/^\s*\|?/, '').replace(/\|?\s*$/, '').trim()
      const header = line.split('|').map(trimCell).filter(c => c)
      i += 2 // 跳过表头与分隔行，指向首条数据行
      const rows: string[][] = []
      while (i < lines.length && classify(lines[i]) === 'table') {
        rows.push(lines[i].split('|').map(trimCell).filter(c => c))
        i++
      }
      const thead = `<thead><tr>${header.map(h => `<th>${inline(h)}</th>`).join('')}</tr></thead>`
      const tbody = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
      out.push(`<table>${thead}${tbody}</table>`)
      continue
    }

    // 段落：连续收集非空且非块起点的行
    const buf: string[] = [line.trim()]
    i++
    while (i < lines.length) {
      const next = lines[i]
      const nextKind = classify(next)
      if (next.trim() === '' || nextKind !== 'paragraphStart') break
      buf.push(next.trim())
      i++
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`)
  }

  return out.join('\n')
}

export default renderMarkdown