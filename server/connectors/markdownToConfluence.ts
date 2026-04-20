export function markdownToConfluenceXhtml(markdown: string): string {
  const lines = markdown.split('\n')
  const output: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    const codeFenceMatch = line.match(/^```(\w*)$/)
    if (codeFenceMatch) {
      const lang = codeFenceMatch[1] || ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      const codeContent = codeLines.join('\n')
      output.push(
        `<ac:structured-macro ac:name="code">` +
        `<ac:parameter ac:name="language">${lang}</ac:parameter>` +
        `<ac:plain-text-body><![CDATA[${codeContent}]]></ac:plain-text-body>` +
        `</ac:structured-macro>`
      )
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const text = inlineFormat(headingMatch[2])
      output.push(`<h${level}>${text}</h${level}>`)
      i++
      continue
    }

    // Table: collect consecutive table lines
    if (line.startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      output.push(buildTable(tableLines))
      continue
    }

    // List items: collect consecutive - or * lines
    if (/^[-*]\s/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        listItems.push(lines[i].replace(/^[-*]\s+/, ''))
        i++
      }
      const items = listItems.map(item => `<li>${inlineFormat(item)}</li>`).join('')
      output.push(`<ul>${items}</ul>`)
      continue
    }

    // Blank line — skip
    if (line.trim() === '') {
      i++
      continue
    }

    // Regular paragraph
    output.push(`<p>${inlineFormat(line)}</p>`)
    i++
  }

  return `<body>${output.join('')}</body>`
}

function buildTable(tableLines: string[]): string {
  const rows = tableLines
    .filter(line => !line.match(/^\|[\s:-]+\|/))
    .map(line =>
      line
        .split('|')
        .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
        .map(cell => cell.trim())
    )

  if (rows.length === 0) return ''

  const [headerRow, ...bodyRows] = rows
  const thead = `<tr>${headerRow.map(cell => `<th>${inlineFormat(cell)}</th>`).join('')}</tr>`
  const tbody = bodyRows.map(row =>
    `<tr>${row.map(cell => `<td>${inlineFormat(cell)}</td>`).join('')}</tr>`
  ).join('')

  return `<table><tbody>${thead}${tbody}</tbody></table>`
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
}

export function validateXhtml(xhtml: string): boolean {
  return xhtml.length > 0 && xhtml.includes('<body>')
}
