import type { Plugin } from "@opencode-ai/plugin"
import { readFile, writeFile, appendFile, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"

const ARTIFACT_NAME = ".sisyphus/session-handoff.md"
const PRESSURE_MARKER = ".sisyphus/context-pressure"
const STATE_FILE = ".sisyphus/.plugin-state.json"

const CLEAN_TEMPLATE = (sid: string, parent: string, model: string, created: string, handoff: number) => `---
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

export const SessionHandoffPlugin: Plugin = async ({ $, directory }) => {
  const artifactPath = join(directory, ARTIFACT_NAME)
  const pressurePath = join(directory, PRESSURE_MARKER)
  const statePath = join(directory, STATE_FILE)

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
    try {
      return parseState(await readFile(statePath, "utf-8"))
    } catch {
      return { lastSession: "", handoffCount: 0 }
    }
  }

  async function saveState(s: PluginState): Promise<void> {
    await mkdir(join(directory, ".sisyphus"), { recursive: true })
    await writeFile(statePath, JSON.stringify(s, null, 2))
  }

  async function readExistingArtifact(): Promise<{
    exists: boolean
    sessionId?: string
    handoffCount?: number
    status?: string
  }> {
    try {
      const content = await readFile(artifactPath, "utf-8")
      const sidMatch = content.match(/^session_id:\s*"([^"]*)"/m)
      const hcMatch = content.match(/^handoff_count:\s*(\d+)/m)
      const stMatch = content.match(/^status:\s*(\w+)/m)
      return {
        exists: true,
        sessionId: sidMatch?.[1] || undefined,
        handoffCount: hcMatch ? parseInt(hcMatch[1], 10) : 0,
        status: stMatch?.[1] || undefined,
      }
    } catch {
      return { exists: false }
    }
  }

  async function initArtifact(sessionID: string, model: string): Promise<void> {
    try {
      const existing = await readExistingArtifact()
      const parentSession = existing.exists ? existing.sessionId || "" : ""
      const isNewHandoff = existing.exists && existing.sessionId && existing.sessionId !== sessionID
      const handoffCount = existing.exists
        ? (existing.handoffCount ?? 0) + (isNewHandoff ? 1 : 0)
        : 0

      const created = new Date().toISOString()
      const template = CLEAN_TEMPLATE(sessionID, parentSession, model, created, handoffCount)

      await writeFile(artifactPath, template)
      await saveState({ lastSession: sessionID, handoffCount })

      await log(
        `artifact init: session=${sessionID} ` +
        `parent=${parentSession || "none"} model=${model} handoff_count=${handoffCount}`,
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
    } catch {
      // All hooks must silently catch — a plugin crash kills the host process.
    }
  }

  await mkdir(join(directory, ".sisyphus"), { recursive: true })
  const state = await loadState()

  const logPath = join(directory, ".sisyphus", ".plugin.log")
  async function log(msg: string): Promise<void> {
    try {
      const ts = new Date().toISOString().replace("T", " ").slice(0, 19)
      await appendFile(logPath, `[${ts}] ${msg}\n`)
    } catch {}
  }

  console.log(`[session-handoff] loaded — ${state.lastSession ? `last: ${state.lastSession}` : "fresh session"}`)

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
