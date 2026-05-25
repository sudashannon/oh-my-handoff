import type { Plugin } from "@opencode-ai/plugin"
import { readFile, writeFile, appendFile, mkdir, stat, readdir, unlink } from "node:fs/promises"
import { join } from "node:path"
import { INHERITED_SECTIONS, MAX_INHERITED_ROWS, CLEAN_TEMPLATE } from "./lib/template"
import {
  extractSection,
  truncateTableRows,
  appendTableRow as appendTableRowPure,
} from "./lib/parse"
import { writeFileAtomic } from "./lib/io"
import { readLock, writeLock, isLockHeldByOther } from "./lib/lock"

const ARTIFACT_NAME = ".sisyphus/session-handoff.md"
const ARCHIVE_DIR = ".sisyphus/archive"
const MAX_ARCHIVE = 20
const LOCK_FILE = ".sisyphus/.session-lock"
const KNOWN_SESSIONS_FILE = ".sisyphus/.known-sessions"
const STANDALONE_PREFIX = "session-handoff-standalone"

export const SessionHandoffPlugin: Plugin = async ({ $, directory }) => {
  let artifactPath = join(directory, ARTIFACT_NAME)
  const archiveDir = join(directory, ARCHIVE_DIR)
  const lockPath = join(directory, LOCK_FILE)
  const knownSessionsPath = join(directory, KNOWN_SESSIONS_FILE)

  let currentSession = ""
  let msgCount = 0
  let compactionCount = 0

  await mkdir(join(directory, ".sisyphus"), { recursive: true })
  await mkdir(archiveDir, { recursive: true })

  await unlink(join(directory, ".sisyphus", ".plugin-state.json")).catch(() => {})

  const logPath = join(directory, ".sisyphus", ".plugin.log")
  async function log(msg: string): Promise<void> {
    try {
      const ts = new Date().toISOString().replace("T", " ").slice(0, 19)
      await appendFile(logPath, `[${ts}] ${msg}\n`)
    } catch {}
  }

  console.log(`[session-handoff] loaded`)

  async function archiveArtifact(oldSessionId: string): Promise<void> {
    try {
      const ts = new Date().toISOString().replace(/[-:.]/g, "")
      const filename = `${ts}_ses_${oldSessionId}.md`
      const dest = join(archiveDir, filename)
      await writeFile(dest, await readFile(artifactPath, "utf-8"))
      await log(`archived: ${filename}`)
    } catch {}
  }

  async function cleanupArchive(): Promise<void> {
    try {
      const entries = await readdir(archiveDir)
      const candidates = entries.filter(f => f.endsWith(".md") && (f.startsWith("ses_") || /^\d{8}T\d/.test(f)))
      if (candidates.length <= MAX_ARCHIVE) return

      const stats = await Promise.all(
        candidates.map(async f => ({ f, mtime: (await stat(join(archiveDir, f))).mtimeMs }))
      )
      stats.sort((a, b) => a.mtime - b.mtime)
      const toDelete = stats.slice(0, stats.length - MAX_ARCHIVE)
      for (const { f } of toDelete) {
        await unlink(join(archiveDir, f))
        await log(`archive cleanup: removed ${f}`)
      }
    } catch {}
  }

  type KnownSessions = Set<string>

  async function readKnownSessions(): Promise<KnownSessions> {
    try {
      const raw = await readFile(knownSessionsPath, "utf-8")
      const arr: string[] = JSON.parse(raw)
      return new Set(arr)
    } catch {
      return new Set()
    }
  }

  async function writeKnownSessions(sessions: KnownSessions): Promise<void> {
    const arr = Array.from(sessions)
    await writeFileAtomic(knownSessionsPath, JSON.stringify(arr))
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
        await writeFileAtomic(artifactPath, template)
        await writeLock(lockPath, { sessionId: sessionID, pid: process.pid, createdAt: Date.now() })
        await log(`artifact created: session=${sessionID} (first session in workspace)`)
        return
      }

      if (existing.sessionId === sessionID) return

      const lock = await readLock(lockPath)
      if (isLockHeldByOther(lock, sessionID, process.pid)) {
        artifactPath = join(
          directory,
          `.sisyphus/${STANDALONE_PREFIX}-${sessionID}.md`,
        )
        const template = CLEAN_TEMPLATE(
          sessionID, "", model,
          new Date().toISOString(), 0, false, new Map(),
        )
        await writeFileAtomic(artifactPath, template)
        await log(
          `concurrent session — lock held by pid=${lock!.pid} sid=${lock!.sessionId} ` +
          `— standalone artifact for ${sessionID}`,
        )
        return
      }

      await archiveArtifact(existing.sessionId)

      const inherited = new Map<string, string>()
      for (const section of INHERITED_SECTIONS) {
        const sec = extractSection(existing.content, section)
        if (sec) {
          const trimmed = truncateTableRows(sec.trim(), MAX_INHERITED_ROWS)
          inherited.set(section, trimmed + "\n\n")
        }
      }

      const newHandoffCount = existing.handoffCount + 1
      // Reaching here means the two early returns above didn't fire,
      // so we are archiving a previous session — this is a handoff by definition.
      const isHandoff = true
      const parentSession = existing.sessionId

      const template = CLEAN_TEMPLATE(
        sessionID, parentSession, model,
        new Date().toISOString(), newHandoffCount, isHandoff,
        inherited,
      )
      await writeFileAtomic(artifactPath, template)
      await writeLock(lockPath, { sessionId: sessionID, pid: process.pid, createdAt: Date.now() })

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
      const newContent = appendTableRowPure(content, section, values)
      if (newContent === null) return
      await writeFileAtomic(artifactPath, newContent)
    } catch {}
  }

  return {
    "chat.message": async (input, _output) => {
      try {
        const sid = input.sessionID

        if (sid !== currentSession) {
          const known = await readKnownSessions()
          const isNew = !known.has(sid)

          if (isNew) {
            known.add(sid)
            await writeKnownSessions(known)

            const modelStr = input.model
              ? `${input.model.providerID}/${input.model.modelID}`
              : "unknown"

            await initArtifact(sid, modelStr)
            await log(`session start: ${sid} (new, model=${modelStr})`)
          } else {
            await log(`session resume: ${sid}`)
          }

          currentSession = sid
          msgCount = 0
          compactionCount = 0
        }

        msgCount++

        const counterFile = join(directory, ".sisyphus", ".msg-counter")
        await writeFileAtomic(counterFile, String(msgCount))

        if (msgCount <= 3 || msgCount % 50 === 0) {
          await log(`msg #${msgCount} session=${sid}`)
        }
      } catch {}
    },

    "experimental.session.compacting": async (input, output) => {
      try {
        compactionCount++

        const compCounterFile = join(directory, ".sisyphus", ".compaction-counter")
        await writeFileAtomic(compCounterFile, String(compactionCount))

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
  }
}
