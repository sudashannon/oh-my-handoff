// Pure template + table constants. No side effects.
// Imported by plugin runtime AND vitest tests so they cannot drift.

export const INHERITED_SECTIONS = [
  "Decision Log",
  "Key Artifacts",
  "Subagent Outputs",
  "Design Outputs",
  "DCP Chapter Index",
] as const

export const TABLE_HEADERS: Record<string, string> = {
  "Decision Log": "| Time | Decision | Context | Alternatives | Rationale |",
  "Key Artifacts": "| File | Purpose | Status |",
  "Subagent Outputs": "| Agent | Task | Key Finding | Timestamp |",
  "Design Outputs": "| Skill | Output | Path |",
  "DCP Chapter Index": "| # | Range | Topic | Summary | DCP Summary |",
}

export const TABLE_SEPARATORS: Record<string, string> = {
  "Decision Log": "|---|---|---|---|---|",
  "Key Artifacts": "|---|---|---|",
  "Subagent Outputs": "|---|---|---|---|",
  "Design Outputs": "|---|---|---|",
  "DCP Chapter Index": "|---|---|---|---|---|",
}

export function CLEAN_TEMPLATE(
  sid: string, parent: string, model: string, created: string,
  handoff: number, isHandoff: boolean,
  inherited: Map<string, string>,
): string {
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
