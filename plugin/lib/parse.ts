// Pure parsing / serialisation helpers. No file I/O.
// Imported by plugin runtime AND vitest tests so they cannot drift.

export type PluginState = {
  lastSession: string
  handoffCount: number
}

export function parseState(raw: string): PluginState {
  try {
    const j = JSON.parse(raw)
    return {
      lastSession: String(j.lastSession || ""),
      handoffCount: Number(j.handoffCount || 0),
    }
  } catch {
    return { lastSession: "", handoffCount: 0 }
  }
}

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
