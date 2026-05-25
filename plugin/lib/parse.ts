// Pure parsing / serialisation helpers. No file I/O.
// Imported by plugin runtime AND vitest tests so they cannot drift.

export type Frontmatter = {
  sessionId?: string
  handoffCount?: number
  status?: string
  isHandoff?: boolean
}

export function readFrontmatter(content: string): Frontmatter {
  const sidMatch = content.match(/^session_id:\s*"([^"]*)"/m)
  const hcMatch = content.match(/^handoff_count:\s*(\d+)/m)
  const stMatch = content.match(/^status:\s*(\w+)/m)
  const ihMatch = content.match(/^is_handoff:\s*(true|false)/m)
  return {
    sessionId: sidMatch?.[1] || undefined,
    handoffCount: hcMatch ? parseInt(hcMatch[1], 10) : 0,
    status: stMatch?.[1] || undefined,
    isHandoff: ihMatch ? ihMatch[1] === "true" : undefined,
  }
}

export function extractSection(content: string, section: string): string {
  const startMarker = `## ${section}`
  const idx = content.indexOf(startMarker)
  if (idx === -1) return ""

  const rest = content.slice(idx + startMarker.length)
  const nextSectionMatch = rest.match(/\n## /)
  const endIdx = nextSectionMatch ? nextSectionMatch.index! : rest.length

  return rest.slice(0, endIdx).trimStart()
}

// Keeps the last `maxRows` data rows of the first markdown table in `content`
// (older rows are dropped, archive preserves full history). Returns `content`
// unchanged when there is no table, no separator, or rows already fit.
export function truncateTableRows(content: string, maxRows: number): string {
  if (maxRows < 0) return content
  const lines = content.split("\n")

  const headerIdx = lines.findIndex(l => l.startsWith("|"))
  if (headerIdx === -1) return content
  const sepIdx = lines.findIndex((l, i) => i > headerIdx && /^\|\s*---/.test(l))
  if (sepIdx === -1) return content

  let endIdx = sepIdx + 1
  while (endIdx < lines.length && lines[endIdx].startsWith("|")) endIdx++

  const dataRows = lines.slice(sepIdx + 1, endIdx)
  if (dataRows.length <= maxRows) return content

  const dropped = dataRows.length - maxRows
  const kept = maxRows === 0 ? [] : dataRows.slice(-maxRows)
  const marker = `<!-- ${dropped} earlier rows trimmed; see .sisyphus/archive/ -->`

  return [
    ...lines.slice(0, headerIdx),
    marker,
    ...lines.slice(headerIdx, sepIdx + 1),
    ...kept,
    ...lines.slice(endIdx),
  ].join("\n")
}

// Returns null if section / separator / blank-line insertion point not found.
export function appendTableRow(
  content: string,
  section: string,
  values: string[],
): string | null {
  const row = `| ${values.join(" | ")} |\n`
  const sectionIndex = content.indexOf(`## ${section}`)
  if (sectionIndex === -1) return null

  const afterSection = content.slice(sectionIndex)
  const lines = afterSection.split("\n")

  let separatorIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if (/^\|---/.test(lines[i])) { separatorIdx = i; break }
  }
  if (separatorIdx === -1) return null

  let insertAt = -1
  for (let i = separatorIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") { insertAt = i; break }
  }
  if (insertAt === -1) return null

  lines.splice(insertAt, 0, row)
  return content.slice(0, sectionIndex) + lines.join("\n")
}
