import type { Plugin } from "@opencode-ai/plugin"
import { readFile, writeFile, appendFile, mkdir, stat, readdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

const ARTIFACT_NAME = ".sisyphus/session-handoff.md"
const PRESSURE_MARKER = ".sisyphus/context-pressure"
const STATE_FILE = ".sisyphus/.plugin-state.json"
const ARCHIVE_DIR = ".sisyphus/archive"
const MAX_ARCHIVE = 20

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

export const SessionHandoffPlugin: Plugin = async ({ $, directory }) => {
  const artifactPath = join(directory, ARTIFACT_NAME)
  const pressurePath = join(directory, PRESSURE_MARKER)
  const statePath = join(directory, STATE_FILE)
  const archiveDir = join(directory, ARCHIVE_DIR)

  let currentSession = ""
  let msgCount = 0
  let compactionCount = 0

  type PluginState = { lastSession: string; handoffCount: number }

  function parseState(raw: string): PluginState {
    try {
      const j = JSON.parse(raw)
      return { lastSession: String(j.lastSession || ""), handoffCount: Number(j.handoffCount || 0) }
    } catch {
      return { lastSession: "", handoffCount: 0 }
    }
  }

  async function loadState(): Promise<PluginState> {
    try { return parseState(await readFile(statePath, "utf-8")) }
    catch { return { lastSession: "", handoffCount: 0 } }
  }

  await mkdir(join(directory, ".sisyphus"), { recursive: true })
  await mkdir(archiveDir, { recursive: true })

  const state = await loadState()

  const logPath = join(directory, ".sisyphus", ".plugin.log")
  async function log(msg: string): Promise<void> {
    try {
      const ts = new Date().toISOString().replace("T", " ").slice(0, 19)
      await appendFile(logPath, `[${ts}] ${msg}\n`)
    } catch {}
  }

  console.log(`[session-handoff] loaded — ${state.lastSession ? `last: ${state.lastSession}` : "fresh workspace"}`)

  async function saveState(s: PluginState): Promise<void> {
    await writeFile(statePath, JSON.stringify(s, null, 2))
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

  async function archiveArtifact(oldSessionId: string): Promise<void> {
    try {
      const dest = join(archiveDir, `ses_${oldSessionId}.md`)
      await writeFile(dest, await readFile(artifactPath, "utf-8"))
      await log(`archived: ses_${oldSessionId}.md`)
    } catch {}
  }

  async function cleanupArchive(): Promise<void> {
    try {
      const entries = await readdir(archiveDir)
      const files = entries.filter(f => f.startsWith("ses_") && f.endsWith(".md"))
      if (files.length <= MAX_ARCHIVE) return

      const sorted = files.sort()
      const toDelete = sorted.slice(0, files.length - MAX_ARCHIVE)
      for (const f of toDelete) {
        await unlink(join(archiveDir, f))
        await log(`archive cleanup: removed ${f}`)
      }
    } catch {}
  }

  async function initArtifact(sessionID: string, model: string): Promise<void> {
    try {
      const readExisting = async () => {
        try {
          const content = await readFile(artifactPath, "utf-8")
          const sidMatch = content.match(/^session_id:\s*"([^"]*)"/m)
          const hcMatch = content.match(/^handoff_count:\s*(\d+)/m)
          return {
            exists: true,
            sessionId: sidMatch?.[1] || "",
            handoffCount: hcMatch ? parseInt(hcMatch[1], 10) : 0,
            content,
          }
        } catch { return { exists: false as const, sessionId: "", handoffCount: 0, content: "" } }
      }

      const existing = await readExisting()

      if (!existing.exists) {
        const template = CLEAN_TEMPLATE(sessionID, "", model, new Date().toISOString(), 0, false, new Map())
        await writeFile(artifactPath, template)
        await saveState({ lastSession: sessionID, handoffCount: 0 })
        await log(`artifact created: session=${sessionID} (first session in workspace)`)
        return
      }

      if (existing.sessionId === sessionID) return

      await archiveArtifact(existing.sessionId)

      const inherited = new Map<string, string>()
      for (const section of INHERITED_SECTIONS) {
        const sec = extractSection(existing.content, section)
        if (sec) inherited.set(section, sec.trim() + "\n\n")
      }

      const newHandoffCount = existing.handoffCount + 1
      // We only reach this branch after passing both early returns (no artifact / same session),
      // so by definition we are archiving a previous session — this IS a handoff.
      const isHandoff = true
      const parentSession = existing.sessionId

      const template = CLEAN_TEMPLATE(
        sessionID, parentSession, model,
        new Date().toISOString(), newHandoffCount, isHandoff,
        inherited,
      )
      await writeFile(artifactPath, template)
      await saveState({ lastSession: sessionID, handoffCount: newHandoffCount })

      await cleanupArchive()

      await log(
        `artifact merge: session=${sessionID} parent=${parentSession} ` +
        `handoff=${newHandoffCount} is_handoff=${isHandoff} ` +
        `inherited=${inherited.size} sections`,
      )
    } catch (err) {
      console.warn(`[session-handoff] initArtifact failed:`, err)
    }
  }

  async function appendTableRow(section: string, values: string[]): Promise<void> {
    try {
      const content = await readFile(artifactPath, "utf-8")
      const row = `| ${values.join(" | ")} |\n`
      const sectionIndex = content.indexOf(`## ${section}`)
      if (sectionIndex === -1) return

      const afterSection = content.slice(sectionIndex)
      const lines = afterSection.split("\n")

      let separatorIdx = -1
      for (let i = 0; i < lines.length; i++) {
        if (/^\|---/.test(lines[i])) { separatorIdx = i; break }
      }
      if (separatorIdx === -1) return

      let insertAt = -1
      for (let i = separatorIdx + 1; i < lines.length; i++) {
        if (lines[i].trim() === "") { insertAt = i; break }
      }
      if (insertAt === -1) return

      lines.splice(insertAt, 0, row)
      const newContent = content.slice(0, sectionIndex) + lines.join("\n")
      await writeFile(artifactPath, newContent)
    } catch {}
  }

  return {
    "chat.message": async (input, _output) => {
      try {
        const sid = input.sessionID

        if (sid !== currentSession) {
          currentSession = sid
          msgCount = 0
          compactionCount = 0

          const modelStr = input.model
            ? `${input.model.providerID}/${input.model.modelID}`
            : "unknown"

          await initArtifact(sid, modelStr)
          await log(`session start: ${sid} (model: ${modelStr})`)
        }

        msgCount++

        const counterFile = join(directory, ".sisyphus", ".msg-counter")
        await writeFile(counterFile, String(msgCount))

        if (msgCount <= 3 || msgCount % 50 === 0) {
          await log(`msg #${msgCount} session=${sid}`)
        }
      } catch {}
    },

    "experimental.session.compacting": async (input, output) => {
      try {
        compactionCount++

        const compCounterFile = join(directory, ".sisyphus", ".compaction-counter")
        await writeFile(compCounterFile, String(compactionCount))

        const now = new Date().toISOString().replace("T", " ").slice(0, 19)
        await appendTableRow("DCP Chapter Index", [
          String(compactionCount),
          input.sessionID,
          "session-compaction",
          `Compaction #${compactionCount} at msg #${msgCount} (${now})`,
          "",
        ])

        try {
          output.context = [
            `Session Handoff Artifact (${ARTIFACT_NAME}):`,
            `  session: ${currentSession}`,
            `  messages: ${msgCount}`,
            `  compactions: ${compactionCount}`,
            `  path: ${directory}/${ARTIFACT_NAME}`,
          ]
        } catch {}

        await log(
          `compaction #${compactionCount} session=${currentSession} msg_count=${msgCount}`,
        )
      } catch {}
    },

    "tool.execute.after": async (input, _output) => {
      try {
        const storageDir = join(
          process.env.HOME || homedir(),
          ".local/share/opencode/storage/plugin/dcp",
        )
        const sessionFile = join(storageDir, `${input.sessionID}.json`)
        try {
          const stats = await stat(sessionFile)
          if (Date.now() - stats.mtimeMs > 60000) return
        } catch {
          return
        }
        await writeFile(pressurePath, `${Date.now()}\n`, { flag: "a" })
      } catch {}
    },
  }
}
