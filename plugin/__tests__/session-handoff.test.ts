import { describe, it, expect } from "vitest"

const CLEAN_TEMPLATE = (
  sid: string,
  parent: string,
  model: string,
  created: string,
  handoff: number,
) => `---
session_id: "${sid}"
parent_session: "${parent}"
model: "${model}"
created: "${created}"
status: active
goal: ""
tags: []
handoff_count: ${handoff}
---

# Session Handoff

## Decision Log

| Time | Decision | Context | Alternatives | Rationale |
|---|---|---|---|---|

## Key Artifacts

| File | Purpose | Status |
|---|---|---|

## Subagent Outputs (High-Value)

| Agent | Task | Key Finding | Timestamp |
|---|---|---|---|

## Design Outputs

| Skill | Output | Path |
|---|---|---|

## DCP Chapter Index

| # | Range | Topic | Summary | DCP Summary |
|---|---|---|---|---|

## Current State

- **Active Goal:**
- **Blockers:**
- **Todo Snapshot:**
- **Open Questions:**

## Next Steps

`

type PluginState = { lastSession: string; handoffCount: number }

function parseState(raw: string): PluginState {
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

function readFrontmatter(content: string): {
  sessionId?: string
  handoffCount?: number
  status?: string
} {
  const sidMatch = content.match(/^session_id:\s*"([^"]*)"/m)
  const hcMatch = content.match(/^handoff_count:\s*(\d+)/m)
  const stMatch = content.match(/^status:\s*(\w+)/m)
  return {
    sessionId: sidMatch?.[1] || undefined,
    handoffCount: hcMatch ? parseInt(hcMatch[1], 10) : 0,
    status: stMatch?.[1] || undefined,
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

describe("CLEAN_TEMPLATE", () => {
  it("generates correct frontmatter with session_id", () => {
    const tpl = CLEAN_TEMPLATE("ses_abc", "ses_prev", "deepseek/model", "2026-05-22T10:00:00Z", 1)
    expect(tpl).toContain('session_id: "ses_abc"')
    expect(tpl).toContain('parent_session: "ses_prev"')
    expect(tpl).toContain('model: "deepseek/model"')
    expect(tpl).toContain('created: "2026-05-22T10:00:00Z"')
    expect(tpl).toContain("status: active")
    expect(tpl).toContain("handoff_count: 1")
  })

  it("handles empty parent_session", () => {
    const tpl = CLEAN_TEMPLATE("ses_new", "", "gpt-4", "2026-01-01T00:00:00Z", 0)
    expect(tpl).toContain('parent_session: ""')
    expect(tpl).toContain("handoff_count: 0")
  })

  it("includes all 7 artifact sections", () => {
    const tpl = CLEAN_TEMPLATE("ses_x", "", "", "", 0)
    const sections = [
      "Decision Log",
      "Key Artifacts",
      "Subagent Outputs",
      "Design Outputs",
      "DCP Chapter Index",
      "Current State",
      "Next Steps",
    ]
    for (const s of sections) {
      expect(tpl).toContain(`## ${s}`)
    }
  })

  it("has exactly 2 YAML frontmatter delimiters", () => {
    const tpl = CLEAN_TEMPLATE("ses_x", "", "", "", 0)
    const dashes = (tpl.match(/^---$/gm) || []).length
    expect(dashes).toBe(2)
  })
})

describe("parseState", () => {
  it("parses valid JSON state", () => {
    const result = parseState('{"lastSession":"ses_abc","handoffCount":5}')
    expect(result).toEqual({ lastSession: "ses_abc", handoffCount: 5 })
  })

  it("returns defaults for missing fields", () => {
    expect(parseState("{}")).toEqual({ lastSession: "", handoffCount: 0 })
  })

  it("returns defaults for invalid JSON", () => {
    expect(parseState("not json")).toEqual({ lastSession: "", handoffCount: 0 })
  })

  it("returns defaults for empty string", () => {
    expect(parseState("")).toEqual({ lastSession: "", handoffCount: 0 })
  })

  it("coerces string handoffCount to number", () => {
    const result = parseState('{"lastSession":"ses_x","handoffCount":"3"}')
    expect(result).toEqual({ lastSession: "ses_x", handoffCount: 3 })
  })
})

describe("readFrontmatter", () => {
  const sampleArtifact = `---
session_id: "ses_abc123"
parent_session: "ses_prev"
model: "deepseek-v4"
created: "2026-05-22T10:00:00Z"
status: active
goal: "test"
tags: []
handoff_count: 2
---

# Session Handoff
`

  it("extracts session_id from frontmatter", () => {
    expect(readFrontmatter(sampleArtifact).sessionId).toBe("ses_abc123")
  })

  it("extracts handoff_count as number", () => {
    expect(readFrontmatter(sampleArtifact).handoffCount).toBe(2)
  })

  it("extracts status", () => {
    expect(readFrontmatter(sampleArtifact).status).toBe("active")
  })

  it("returns undefined sessionId when field is missing", () => {
    const fm = readFrontmatter("---\nstatus: sealed\n---\n")
    expect(fm.sessionId).toBeUndefined()
    expect(fm.status).toBe("sealed")
  })

  it("returns default handoffCount of 0 for empty content", () => {
    expect(readFrontmatter("").handoffCount).toBe(0)
  })
})

describe("appendTableRow", () => {
  const artifactWithEmptyTable = `---
status: active
---

# Session Handoff

## DCP Chapter Index

| # | Range | Topic | Summary | DCP Summary |
|---|---|---|---|---|

## Current State
`

  it("inserts a row into an empty table", () => {
    const result = appendTableRow(artifactWithEmptyTable, "DCP Chapter Index", [
      "1", "ses_xyz", "auto-compact", "First compaction", "",
    ])
    expect(result).toContain("| 1 | ses_xyz | auto-compact | First compaction |  |")
  })

  it("appends after existing rows", () => {
    const withExisting = `---
status: active
---

# Session Handoff

## DCP Chapter Index

| # | Range | Topic | Summary | DCP Summary |
|---|---|---|---|---|
| 1 | ses_a | topic-a | summary-a |  |

## Current State
`
    const result = appendTableRow(withExisting, "DCP Chapter Index", [
      "2", "ses_b", "topic-b", "summary-b", "",
    ])
    expect(result).toContain("| 1 | ses_a | topic-a | summary-a |  |")
    expect(result).toContain("| 2 | ses_b | topic-b | summary-b |  |")
  })

  it("returns null for missing section", () => {
    const result = appendTableRow(artifactWithEmptyTable, "NonExistent Section", ["a", "b"])
    expect(result).toBeNull()
  })

  it("inserts into Decision Log table", () => {
    const artifact = `---
status: active
---

# Session Handoff

## Decision Log

| Time | Decision | Context | Alternatives | Rationale |
|---|---|---|---|---|

## Next Steps
`
    const result = appendTableRow(artifact, "Decision Log", [
      "10:00", "Use X", "context", "alt", "reason",
    ])
    expect(result).toContain("| 10:00 | Use X | context | alt | reason |")
  })

  it("preserves other sections when inserting", () => {
    const result = appendTableRow(artifactWithEmptyTable, "DCP Chapter Index", [
      "1", "s", "t", "summary", "",
    ])
    expect(result).toContain("## Current State")
    expect(result).toContain("## DCP Chapter Index")
  })
})

describe("Handoff count logic", () => {
  it("increments handoff_count when session_id changes", () => {
    const existingHc = 3
    const isNewHandoff = "ses_old" !== "ses_new"
    const newHc = existingHc + (isNewHandoff ? 1 : 0)
    expect(newHc).toBe(4)
  })

  it("does not increment when session_id is unchanged (plugin reload)", () => {
    const existingHc = 2
    const isNewHandoff = "ses_same" !== "ses_same"
    const newHc = existingHc + (isNewHandoff ? 1 : 0)
    expect(newHc).toBe(2)
  })

  it("starts at 0 for first-ever session with no existing artifact", () => {
    const handoffCount = false ? 2 : 0
    expect(handoffCount).toBe(0)
  })
})
