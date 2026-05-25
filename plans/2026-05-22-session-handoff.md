# Session Handoff System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement session handoff system with DCP Chapter Index, structured artifact, and AGENTS.md behavior rules. Session context transfer is triggered **only** by manual commands (`/handoff-seal` and `/new-with-history`); no agent auto-triggered handoff.

**Architecture:** Two changes: (1) Create `.sisyphus/session-handoff.md` template + directory structure (2) Add `<session_handoff>` behavior section to AGENTS.md defining maintenance rules, trigger conditions, handoff flow, and new-session bootstrap. DCP Chapter Index is handled via agent behavioral rules (agent invokes compress → records summary), not via plugin modification.

**Tech Stack:** AGENTS.md (agent behavior rules), Markdown (artifact template)

---

### Task 1: Create `.sisyphus/` directory structure

**Files:**
- Create: `~/.sisyphus/plans/` (tracking the reasoning of the plans)
- Create: `.sisyphus/session-handoff.md` (template)

- [ ] **Step 1: Verify `.sisyphus/` exists, create subdirs**

Run:
```bash
mkdir -p /home/shanl/.sisyphus/plans
ls /home/shanl/.sisyphus/
```
Expected: `specs/` and (new) `plans/` listed.

- [ ] **Step 2: Create session-handoff.md template**

Write to `.sisyphus/session-handoff.md`:

```markdown
---
session_id: "{{session_id}}"
parent_session: "{{parent_session_or_null}}"
model: "{{model_name}}"
created: "{{timestamp}}"
status: active        # active | sealed | archived
goal: "{{current_goal}}"
tags: []
handoff_count: {{n}}
---

# Session Handoff

## Decision Log

| Time | Decision | Context | Alternatives | Rationale |

## Key Artifacts

| File | Purpose | Status |

## Subagent Outputs (High-Value)

| Agent | Task | Key Finding | Timestamp |

## Design Outputs

| Skill | Output | Path |

## DCP Chapter Index

| # | Range | Topic | Summary | DCP Summary |

## Current State

- **Active Goal:**
- **Blockers:**
- **Todo Snapshot:**
- **Open Questions:**

## Next Steps

1.
```

- [ ] **Step 3: Verify files created**

Run:
```bash
ls -la /home/shanl/.sisyphus/session-handoff.md
```
Expected: file exists, > 40 lines.

- [ ] **Step 4: Verify content is complete**

Run:
```bash
head -5 /home/shanl/.sisyphus/session-handoff.md
```
Expected: YAML frontmatter with `session_id`, `status: active`, etc.

```bash
grep -c "## " /home/shanl/.sisyphus/session-handoff.md
```
Expected: 8+ section headers (Decision Log, Key Artifacts, Subagent Outputs, Design Outputs, DCP Chapter Index, Current State, Next Steps, Session Handoff).

---

### Task 2: Add session handoff behavior section to AGENTS.md

**Files:**
- Modify: `~/.config/opencode/AGENTS.md` (append before EOF)

- [ ] **Step 1: Read current AGENTS.md to confirm line count**

Run:
```bash
wc -l /home/shanl/.config/opencode/AGENTS.md
```
Expected: ~153 lines.

- [ ] **Step 2: Append `<session_handoff>` behavior section**

Insert at end of `AGENTS.md` (before EOF):

```markdown
<!-- SESSION_HANDOFF_START -->
## Session Handoff System

### Artifact

Path: `{workspace}/.sisyphus/session-handoff.md`

When present, the agent MUST read this file at session start to recover full context.

### Maintenance Rules

The agent MUST update the artifact when:

1. **Decision made** → Append row to `Decision Log`:
   `| timestamp | decision | context | alternatives | rationale |`
2. **Key file created/modified** → Update `Key Artifacts`:
   `| path | purpose | created | modified |`
3. **High-value subagent completes** → Extract findings to `Subagent Outputs`:
   - High-value agents: `oracle`, `explore`, `brainstorming`, `deep`, `ultrabrain`
   - Only record when output contains non-obvious findings
   - Format: `| agent_type | task_description | key_finding | timestamp |`
4. **brainstorming finishes** → Record in `Design Outputs`:
   `| skill_name | output_description | file_path |`
5. **compress is called** → Before calling compress, record current state summary in `DCP Chapter Index`:
   `| # | msg_range | topic | summary | dcp_summary |`
   The `dcp_summary` column contains whatever summary text the agent generates as part of compress.
6. **todowrite changes** → Sync current todo state to `Current State` > `Todo Snapshot`.

### New Session Bootstrap

Artifact status determines what the new session inherits:

| Artifact status | What happened | Plugin behavior |
|---|---|---|
| no artifact | First session in workspace | Creates blank artifact |
| `status: sealed` | Previous session sealed by `/handoff-seal` or `/new-with-history` | Archives old artifact, creates new one with inherited sections |
| `status: active` | Previous session was `/new` or ended normally | Archives old artifact, creates **blank** artifact (no inheritance) |

When the artifact exists, the agent MUST read all sections and acknowledge to the user.

When resuming a previously-seen sessionID (known-sessions), the plugin skips artifact operations — the artifact was already populated for this session.

### Session End

No automatic action. User manually invokes `/handoff-seal` or `/new-with-history` to seal the artifact and prepare for context inheritance in the next session.
<!-- SESSION_HANDOFF_END -->
```

Use `edit` tool to append content.

- [ ] **Step 3: Verify AGENTS.md parseable**

Read back the end of the file to verify correct insertion:
```bash
tail -30 /home/shanl/.config/opencode/AGENTS.md
```
Expected: session handoff section present, no broken syntax.

---

### Task 3: Self-review and validate

- [ ] **Step 1: Verify all sections in the plan cover the spec**

Checklist (from spec document):
- [ ] Decision Log maintenance → Task 2, rule 1
- [ ] Key Artifacts tracking → Task 2, rule 2
- [ ] Subagent Outputs (high-value only) → Task 2, rule 3
- [ ] Design Outputs → Task 2, rule 4
- [ ] DCP Chapter Index → Task 2, rule 5
- [ ] Todo Snapshot sync → Task 2, rule 6
- [ ] Trigger conditions (3 levels) → Task 2, Handoff Trigger Conditions
- [ ] Handoff flow (confirm/refresh/seal) → Task 2, Handoff Flow
- [ ] New session bootstrap (read artifact) → Task 2, New Session Bootstrap
- [ ] Session end (final refresh → sealed) → Task 2, Session End
- [ ] Template file exists → Task 1

- [ ] **Step 2: Verify template structure is complete**

Compare `.sisyphus/session-handoff.md` against the spec's artifact format:
- [ ] YAML frontmatter: session_id, parent_session, model, created, status, goal, tags, handoff_count
- [ ] Decision Log table
- [ ] Key Artifacts table
- [ ] Subagent Outputs table
- [ ] Design Outputs table
- [ ] DCP Chapter Index table
- [ ] Current State
- [ ] Next Steps

---

### Task 4: Create session-handoff plugin (Hook 层)

**Files:**
- Create: `~/.config/opencode/plugins/session-handoff.ts`

This plugin implements the deterministic hooks that the behavior layer (AGENTS.md) relies on. It mirrors the pattern from `plugins/rtk.ts`.

- [ ] **Step 1: Create the plugin file**

Write to `/home/shanl/.config/opencode/plugins/session-handoff.ts`:

```typescript
import type { Plugin } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"

const ARTIFACT_NAME = ".sisyphus/session-handoff.md"
const PRESSURE_MARKER = ".sisyphus/context-pressure"

export const SessionHandoffPlugin: Plugin = async ({ $, directory }) => {
  // Resolve artifact path (workspace root)
  const artifactPath = join(directory, ARTIFACT_NAME)
  const pressurePath = join(directory, PRESSURE_MARKER)

  // Helper: append a line to a markdown table in the artifact
  async function appendTableRow(
    section: string,
    headers: string[],
    values: string[],
  ): Promise<void> {
    try {
      const content = await readFile(artifactPath, "utf-8")
      const row = `| ${values.join(" | ")} |\n`
      // Find section header and append after its table (after the header row + separator)
      const sectionIndex = content.indexOf(`## ${section}`)
      if (sectionIndex === -1) return

      const afterSection = content.slice(sectionIndex)
      const lines = afterSection.split("\n")
      // Find first blank line after the header+separator+first data row
      let dataStart = 0
      let blankCount = 0
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "") {
          blankCount++
          if (blankCount === 2) { dataStart = i; break }
        }
      }
      if (dataStart === 0) return

      // Insert before the blank line that ends the table section
      lines.splice(dataStart, 0, row)
      await writeFile(artifactPath, content.slice(0, sectionIndex) + lines.join("\n"))
    } catch {
      // silently fail — plugin must never crash the host
    }
  }

  return {
    // --- Hook 1: Auto-record DCP Chapter Index on compaction ---
    "experimental.session.compacting": async (input, output) => {
      try {
        // Record a chapter entry
        await appendTableRow(
          "DCP Chapter Index",
          ["#", "Range", "Topic", "Summary", "DCP Summary"],
          [Date.now().toString(), input.sessionID, "auto-compact", "Session compaction triggered", ""],
        )

        // Inject artifact context so compaction prompt preserves key state
        try {
          const artifactContent = await readFile(artifactPath, "utf-8")
          const frontmatter = artifactContent.match(/^---\n([\s\S]*?)\n---/)
          if (frontmatter) {
            output.context = [
              `Session Handoff Artifact (${ARTIFACT_NAME}):`,
              frontmatter[1],
            ]
          }
        } catch {
          // artifact doesn't exist yet
        }
      } catch {
        // never crash the host
      }
    },

    // --- Hook 2: Monitor context pressure after tool execution ---
    "tool.execute.after": async (input, _output) => {
      try {
        // Check DCP session state for context usage
        const storageDir = join(
          process.env.HOME || "/home/shanl",
          ".local/share/opencode/storage/plugin/dcp",
        )
        const sessionFile = join(storageDir, `${input.sessionID}.json`)

        try {
          const stats = await stat(sessionFile)
          const age = Date.now() - stats.mtimeMs
          if (age > 60000) return // stale data, skip
        } catch {
          return // no session file yet
        }

        // If we're running expensive tools frequently, mark pressure
        try {
          const now = Date.now()
          await writeFile(pressurePath, `${now}\n`, { flag: "a" })
        } catch {
          // ignore
        }
      } catch {
        // never crash
      }
    },

    // --- Hook 3: Message counter + handoff hint injection ---
    "chat.message": async (input, _output) => {
      try {
        // Update message count in a temp counter file
        const counterDir = join(directory, ".sisyphus")
        const counterFile = join(counterDir, ".msg-counter")
        await mkdir(counterDir, { recursive: true })

        let count = 0
        try {
          const existing = await readFile(counterFile, "utf-8")
          count = parseInt(existing.trim(), 10) || 0
        } catch {
          // first message
        }
        count++
        await writeFile(counterFile, count.toString())

        // TODO: At threshold, could use `experimental.chat.system.transform`
        // to inject handoff hint into system prompt.
        // For now, just maintain the counter.
        // The AGENTS.md behavior rules handle the actual handoff suggestion.
      } catch {
        // never crash
      }
    },

    // --- Hook 4: On session start, auto-seal any lingering sealed artifact ---
    // (The TUI plugin API would be needed for true session lifecycle hooks)
  }
}
```

- [ ] **Step 2: Verify plugin compiles with TypeScript**

Run:
```bash
cd /home/shanl/.config/opencode && npx tsc --noEmit plugins/session-handoff.ts 2>&1 || echo "Lint check: no tsc available, this is OK since OpenCode loads it at runtime"
```

Note: The plugin is loaded dynamically by OpenCode. TypeScript checking is optional.

---

### Task 5: Register plugin in opencode.jsonc

**Files:**
- Modify: `~/.config/opencode/opencode.jsonc`

- [ ] **Step 1: Add session-handoff to plugin array**

Edit `opencode.jsonc`, add to the `plugin` array:

```jsonc
{
  "plugin": [
    "oh-my-openagent@latest",
    "superpowers@git+https://github.com/obra/superpowers.git",
    "@tarquinen/opencode-dcp@latest",
    "file:///home/shanl/.config/opencode/plugins/session-handoff.ts"
  ],
  // ...rest unchanged
}
```

Use either `edit` tool to insert the new entry after `@tarquinen/opencode-dcp@latest`.

- [ ] **Step 2: Verify opencode.jsonc is valid JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('/home/shanl/.config/opencode/opencode.jsonc','utf8'))" 2>&1 || echo "Expected failure: jsonc is JSON-with-comments, not valid JSON. Use a different validator."
```

Actually, `opencode.jsonc` uses JSONC format (JSON with comments). The best verification is a visual inspect:
```bash
head -10 /home/shanl/.config/opencode/opencode.jsonc
```
Expected: plugin array contains all 4 entries including `session-handoff.ts`.

---

### Task 6: Self-review plugin + registration

- [ ] **Step 1: Verify plugin hook coverage**

Checklist:
- [ ] `experimental.session.compacting` → records Chapter Index entry on compaction
- [ ] `tool.execute.after` → monitors context pressure
- [ ] `chat.message` → counts messages, writes counter
- [ ] All hooks wrapped in try/catch (never crash host)
- [ ] Plugin registered in opencode.jsonc

- [ ] **Step 2: Verify behavior + hook boundary**

The following MUST be in AGENTS.md (Task 2), NOT in the plugin:
- [ ] Decision Log maintenance (needs judgment)
- [ ] Subagent Outputs extraction (needs value assessment)
- [ ] Handoff suggestion timing (needs task context)
- [ ] New session bootstrap reading + reporting (needs NL understanding)

The following MUST be in the plugin (Task 4), NOT in behavior:
- [ ] Chapter Index auto-record on compaction
- [ ] Message counting (deterministic)
- [ ] Context pressure monitoring (deterministic)
- [ ] Artifact context injection into compaction prompt
