import type { Plugin } from "@opencode-ai/plugin"
import { readFile, writeFile, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"

const ARTIFACT_NAME = ".sisyphus/session-handoff.md"
const PRESSURE_MARKER = ".sisyphus/context-pressure"

export const SessionHandoffPlugin: Plugin = async ({ $, directory }) => {
  const artifactPath = join(directory, ARTIFACT_NAME)
  const pressurePath = join(directory, PRESSURE_MARKER)

  async function appendTableRow(
    section: string,
    _headers: string[],
    values: string[],
  ): Promise<void> {
    try {
      const content = await readFile(artifactPath, "utf-8")
      const row = `| ${values.join(" | ")} |\n`
      const sectionIndex = content.indexOf(`## ${section}`)
      if (sectionIndex === -1) return

      const afterSection = content.slice(sectionIndex)
      const lines = afterSection.split("\n")
      let dataStart = 0
      let blankCount = 0
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "") {
          blankCount++
          if (blankCount === 2) { dataStart = i; break }
        }
      }
      if (dataStart === 0) return

      lines.splice(dataStart, 0, row)
      await writeFile(artifactPath, content.slice(0, sectionIndex) + lines.join("\n"))
    } catch {
    }
  }

  return {
    "experimental.session.compacting": async (input, output) => {
      try {
        await appendTableRow(
          "DCP Chapter Index",
          ["#", "Range", "Topic", "Summary", "DCP Summary"],
          [Date.now().toString(), input.sessionID, "auto-compact", "Session compaction triggered", ""],
        )
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
        }
      } catch {
      }
    },

    "tool.execute.after": async (input, _output) => {
      try {
        const storageDir = join(
          process.env.HOME || "/home/shanl",
          ".local/share/opencode/storage/plugin/dcp",
        )
        const sessionFile = join(storageDir, `${input.sessionID}.json`)
        try {
          const stats = await stat(sessionFile)
          const age = Date.now() - stats.mtimeMs
          if (age > 60000) return
        } catch {
          return
        }
        try {
          await writeFile(pressurePath, `${Date.now()}\n`, { flag: "a" })
        } catch {
        }
      } catch {
      }
    },

    "chat.message": async (input, _output) => {
      try {
        const counterDir = join(directory, ".sisyphus")
        const counterFile = join(counterDir, ".msg-counter")
        await mkdir(counterDir, { recursive: true })
        let count = 0
        try {
          const existing = await readFile(counterFile, "utf-8")
          count = parseInt(existing.trim(), 10) || 0
        } catch {
        }
        count++
        await writeFile(counterFile, count.toString())
      } catch {
      }
    },
  }
}
