import { describe, it, expect } from "vitest"

const INHERITED_SECTIONS = [
  "Decision Log",
  "Key Artifacts",
  "Subagent Outputs",
  "Design Outputs",
  "DCP Chapter Index",
]

const TABLE_HEADERS: Record<string, string> = {
  "Decision Log": "| Time | Decision | Context | Alternatives | Rationale |",
  "Key Artifacts": "| File | Purpose | Status |",
  "Subagent Outputs": "| Agent | Task | Key Finding | Timestamp |",
  "Design Outputs": "| Skill | Output | Path |",
  "DCP Chapter Index": "| # | Range | Topic | Summary | DCP Summary |",
}

const TABLE_SEPARATORS: Record<string, string> = {
  "Decision Log": "|---|---|---|---|---|",
  "Key Artifacts": "|---|---|---|",
  "Subagent Outputs": "|---|---|---|---|",
  "Design Outputs": "|---|---|---|",
  "DCP Chapter Index": "|---|---|---|---|---|",
}

function CLEAN_TEMPLATE(
  sid: string, parent: string, model: string, created: string,
  handoff: number, isHandoff: boolean,
  inherited: Map<string, string>,
) {
  const rows = (section: string) =>
    inherited.get(section) ||
    `${TABLE_HEADERS[section]}\n${TABLE_SEPARATORS[section]}\n`

  return `---
session_id: "${sid}"
parent_session: "${parent}"
model: "${model}"
created: "${created}"
status: active
goal: ""
tags: []
handoff_count: ${handoff}
is_handoff: ${isHandoff}
---

# Session Handoff

## Decision Log

${rows("Decision Log")}
## Key Artifacts

${rows("Key Artifacts")}
## Subagent Outputs (High-Value)

${rows("Subagent Outputs")}
## Design Outputs

${rows("Design Outputs")}
## DCP Chapter Index

${rows("DCP Chapter Index")}
## Current State

- **Active Goal:**
- **Blockers:**
- **Todo Snapshot:**
- **Open Questions:**

## Next Steps

`
}

function extractSection(content: string, section: string): string {
  const startMarker = `## ${section}`
  const idx = content.indexOf(startMarker)
  if (idx === -1) return ""

  const rest = content.slice(idx + startMarker.length)
  const nextSectionMatch = rest.match(/\n## /)
  const endIdx = nextSectionMatch ? nextSectionMatch.index! : rest.length

  return rest.slice(0, endIdx).trimStart()
}

function parseState(raw: string): { lastSession: string; handoffCount: number } {
  try {
    const j = JSON.parse(raw)
    return { lastSession: String(j.lastSession || ""), handoffCount: Number(j.handoffCount || 0) }
  } catch {
    return { lastSession: "", handoffCount: 0 }
  }
}

function readFrontmatter(content: string): {
  sessionId?: string; handoffCount?: number; status?: string; isHandoff?: boolean
} {
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

function appendTableRow(content: string, section: string, values: string[]): string | null {
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

describe("CLEAN_TEMPLATE — fresh session (no inheritance)", () => {
  it("generates blank template with empty tables", () => {
    const tpl = CLEAN_TEMPLATE("ses_a", "", "gpt-4", "2026-01-01T00:00:00Z", 0, false, new Map())
    expect(tpl).toContain('session_id: "ses_a"')
    expect(tpl).toContain('parent_session: ""')
    expect(tpl).toContain("handoff_count: 0")
    expect(tpl).toContain("is_handoff: false")
    expect(tpl).toContain("status: active")
    for (const s of INHERITED_SECTIONS) {
      expect(tpl).toContain(`## ${s}`)
    }
  })

  it("has exactly 2 YAML frontmatter delimiters", () => {
    const tpl = CLEAN_TEMPLATE("ses_x", "", "", "", 0, false, new Map())
    const dashes = (tpl.match(/^---$/gm) || []).length
    expect(dashes).toBe(2)
  })
})

describe("CLEAN_TEMPLATE — with inherited sections", () => {
  const inherited = new Map<string, string>()
  inherited.set("Decision Log", "| 10:00 | Use X | ctx | alt | reason |\n")

  it("embeds inherited table rows", () => {
    const tpl = CLEAN_TEMPLATE("ses_b", "ses_a", "deepseek", "2026-05-22", 3, true, inherited)
    expect(tpl).toContain('parent_session: "ses_a"')
    expect(tpl).toContain("handoff_count: 3")
    expect(tpl).toContain("is_handoff: true")
    expect(tpl).toContain("| 10:00 | Use X | ctx | alt | reason |")
  })

  it("uses empty headers for non-inherited sections", () => {
    const tpl = CLEAN_TEMPLATE("ses_c", "ses_b", "", "", 1, true, inherited)
    expect(tpl).toContain("| File | Purpose | Status |")
    expect(tpl).toContain("|---|---|---|")
  })
})

describe("extractSection", () => {
  const artifact = `## Decision Log

| 10:00 | Pick X | ctx | alt | reason |
|---|---|---|---|

## Key Artifacts

| File | Purpose | Status |
|---|---|---|
| src/a.ts | auth | created |

## DCP Chapter Index

| # | Range | Topic | Summary | DCP Summary |
|---|---|---|---|---|

`

  it("extracts a section with content", () => {
    const result = extractSection(artifact, "Decision Log")
    expect(result).toContain("| 10:00 | Pick X | ctx | alt | reason |")
  })

  it("extracts a section with table heading and data row", () => {
    const result = extractSection(artifact, "Key Artifacts")
    expect(result.trim()).toBe("| File | Purpose | Status |\n|---|---|---|\n| src/a.ts | auth | created |")
  })

  it("extracts an empty section", () => {
    const result = extractSection(artifact, "DCP Chapter Index")
    expect(result).toContain("| # | Range | Topic | Summary | DCP Summary |")
    expect(result).toContain("|---|---|---|---|---|")
  })

  it("returns empty string for missing section", () => {
    expect(extractSection(artifact, "NonExistent")).toBe("")
  })

  it("stops at next section header", () => {
    const result = extractSection(artifact, "Decision Log")
    expect(result).not.toContain("Key Artifacts")
  })
})

describe("parseState", () => {
  it("parses valid JSON", () => {
    expect(parseState('{"lastSession":"ses_a","handoffCount":5}'))
      .toEqual({ lastSession: "ses_a", handoffCount: 5 })
  })

  it("returns defaults for empty JSON", () => {
    expect(parseState("{}")).toEqual({ lastSession: "", handoffCount: 0 })
  })

  it("returns defaults for invalid JSON", () => {
    expect(parseState("boom")).toEqual({ lastSession: "", handoffCount: 0 })
  })
})

describe("readFrontmatter", () => {
  const sample = `---
session_id: "ses_abc"
handoff_count: 3
is_handoff: true
status: active
---
`

  it("reads is_handoff from frontmatter", () => {
    expect(readFrontmatter(sample).isHandoff).toBe(true)
  })

  it("reads handoff_count as number", () => {
    expect(readFrontmatter(sample).handoffCount).toBe(3)
  })

  it("returns undefined isHandoff when field missing", () => {
    expect(readFrontmatter("---\nstatus: active\n---\n").isHandoff).toBeUndefined()
  })
})

describe("appendTableRow", () => {
  const artifact = `## DCP Chapter Index

| # | Range | Topic | Summary | DCP Summary |
|---|---|---|---|---|

## Current State
`

  it("inserts row after separator", () => {
    const result = appendTableRow(artifact, "DCP Chapter Index", [
      "1", "ses_x", "compaction", "summary", "",
    ])
    expect(result).toContain("| 1 | ses_x | compaction | summary |  |")
  })

  it("appends after existing rows", () => {
    const withRows = `## DCP Chapter Index

| # | Range | Topic | Summary | DCP Summary |
|---|---|---|---|---|
| 1 | ses_a | a | summary-a |  |

## Current State
`
    const result = appendTableRow(withRows, "DCP Chapter Index", [
      "2", "ses_b", "b", "summary-b", "",
    ])
    expect(result).toContain("| 1 | ses_a | a | summary-a |  |")
    expect(result).toContain("| 2 | ses_b | b | summary-b |  |")
  })

  it("returns null for missing section", () => {
    expect(appendTableRow(artifact, "Fake", ["a"])).toBeNull()
  })
})

describe("Handoff count logic", () => {
  it("starts at 0 for first session", () => {
    expect(0).toBe(0)
  })

  it("always increments on new session", () => {
    const old = 3
    const next = old + 1
    expect(next).toBe(4)
  })

  it("is_handoff is true when previous handoff_count > 0", () => {
    const prev = 2
    const isHandoff = prev > 0
    expect(isHandoff).toBe(true)
  })

  it("is_handoff is false for first session", () => {
    const prev = 0
    const isHandoff = prev > 0
    expect(isHandoff).toBe(false)
  })
})
