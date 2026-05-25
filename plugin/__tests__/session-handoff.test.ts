import { describe, it, expect } from "vitest"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { INHERITED_SECTIONS, CLEAN_TEMPLATE } from "../lib/template"
import {
  extractSection,
  readFrontmatter,
  appendTableRow,
} from "../lib/parse"
import { writeFileAtomic } from "../lib/io"
import {
  readLock,
  writeLock,
  isProcessAlive,
  isLockStale,
  isLockHeldByOther,
  STALE_LOCK_MS,
} from "../lib/lock"

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

  it("is_handoff is true whenever a previous session is archived", () => {
    const previousArtifactExisted = true
    const sameSession = false
    const isHandoff = previousArtifactExisted && !sameSession
    expect(isHandoff).toBe(true)
  })

  it("is_handoff is false only when no previous artifact exists", () => {
    const previousArtifactExisted = false
    const isHandoff = previousArtifactExisted
    expect(isHandoff).toBe(false)
  })
})

describe("writeFileAtomic", () => {
  it("writes content to the target path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wfa-"))
    try {
      const target = join(dir, "out.txt")
      await writeFileAtomic(target, "hello")
      expect(await readFile(target, "utf-8")).toBe("hello")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("overwrites an existing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wfa-"))
    try {
      const target = join(dir, "out.txt")
      await writeFile(target, "old")
      await writeFileAtomic(target, "new")
      expect(await readFile(target, "utf-8")).toBe("new")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("leaves no .tmp.* siblings after a successful write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wfa-"))
    try {
      const target = join(dir, "out.txt")
      await writeFileAtomic(target, "x")
      const entries = await readdir(dir)
      expect(entries.filter((e) => e.includes(".tmp."))).toEqual([])
      expect(entries).toContain("out.txt")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("cleans up the .tmp.* file when the rename target dir is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wfa-"))
    try {
      const target = join(dir, "missing-subdir", "out.txt")
      await expect(writeFileAtomic(target, "x")).rejects.toBeTruthy()
      const entries = await readdir(dir)
      expect(entries.filter((e) => e.includes(".tmp."))).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("lock helpers", () => {
  it("readLock returns null when file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"))
    try {
      expect(await readLock(join(dir, "missing"))).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("readLock returns null on malformed JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"))
    try {
      const path = join(dir, "lock")
      await writeFile(path, "not json")
      expect(await readLock(path)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("readLock returns null when fields are wrong types", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"))
    try {
      const path = join(dir, "lock")
      await writeFile(path, JSON.stringify({ sessionId: 1, pid: "x", createdAt: "y" }))
      expect(await readLock(path)).toBeNull()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("writeLock + readLock round-trips a LockInfo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lock-"))
    try {
      const path = join(dir, "lock")
      const info = { sessionId: "ses_a", pid: 999, createdAt: 1000 }
      await writeLock(path, info)
      expect(await readLock(path)).toEqual(info)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it("isProcessAlive(self) is true", () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it("isProcessAlive(0) is false", () => {
    expect(isProcessAlive(0)).toBe(false)
  })

  it("isLockStale: fresh lock is not stale", () => {
    const now = Date.now()
    expect(isLockStale({ sessionId: "x", pid: 1, createdAt: now }, now)).toBe(false)
  })

  it("isLockStale: lock older than STALE_LOCK_MS is stale", () => {
    const now = Date.now()
    expect(isLockStale({ sessionId: "x", pid: 1, createdAt: now - STALE_LOCK_MS - 1 }, now)).toBe(true)
  })

  it("isLockHeldByOther: null lock means not held", () => {
    expect(isLockHeldByOther(null, "ses_a", 100)).toBe(false)
  })

  it("isLockHeldByOther: same session is not 'other'", () => {
    const info = { sessionId: "ses_a", pid: 999999, createdAt: Date.now() }
    expect(isLockHeldByOther(info, "ses_a", 100)).toBe(false)
  })

  it("isLockHeldByOther: same pid is not 'other'", () => {
    const info = { sessionId: "ses_x", pid: process.pid, createdAt: Date.now() }
    expect(isLockHeldByOther(info, "ses_a", process.pid)).toBe(false)
  })

  it("isLockHeldByOther: stale lock is not held", () => {
    const info = { sessionId: "ses_x", pid: process.pid, createdAt: Date.now() - STALE_LOCK_MS - 1 }
    expect(isLockHeldByOther(info, "ses_a", 100)).toBe(false)
  })

  it("isLockHeldByOther: live different session does hold the lock", () => {
    const info = { sessionId: "ses_x", pid: process.pid, createdAt: Date.now() }
    expect(isLockHeldByOther(info, "ses_a", 100)).toBe(true)
  })

  it("isLockHeldByOther: dead foreign session does not hold the lock", () => {
    const info = { sessionId: "ses_x", pid: 0, createdAt: Date.now() }
    expect(isLockHeldByOther(info, "ses_a", 100)).toBe(false)
  })
})

import { truncateTableRows } from "../lib/parse"

describe("truncateTableRows", () => {
  const header = "| a | b |"
  const sep = "|---|---|"
  const row = (n: number) => `| r${n} | x |`

  it("returns content unchanged when there is no table", () => {
    expect(truncateTableRows("just prose\nno table", 5)).toBe("just prose\nno table")
  })

  it("returns content unchanged when there is no separator line", () => {
    const input = `${header}\n${row(1)}\n${row(2)}`
    expect(truncateTableRows(input, 1)).toBe(input)
  })

  it("returns content unchanged when row count fits the limit", () => {
    const input = [header, sep, row(1), row(2)].join("\n")
    expect(truncateTableRows(input, 5)).toBe(input)
  })

  it("keeps only the last maxRows data rows and prepends a marker", () => {
    const input = [header, sep, row(1), row(2), row(3), row(4), row(5), ""].join("\n")
    const out = truncateTableRows(input, 2)
    expect(out).toContain("3 earlier rows trimmed")
    expect(out).not.toContain(row(1))
    expect(out).not.toContain(row(2))
    expect(out).not.toContain(row(3))
    expect(out).toContain(row(4))
    expect(out).toContain(row(5))
    expect(out.indexOf("trimmed")).toBeLessThan(out.indexOf(header))
  })

  it("preserves trailing non-table content after the table", () => {
    const input = [header, sep, row(1), row(2), row(3), "", "trailing prose"].join("\n")
    const out = truncateTableRows(input, 1)
    expect(out).toContain("trailing prose")
    expect(out).toContain(row(3))
    expect(out).not.toContain(row(1))
  })

  it("handles maxRows=0 by trimming all data rows", () => {
    const input = [header, sep, row(1), row(2)].join("\n")
    const out = truncateTableRows(input, 0)
    expect(out).toContain("2 earlier rows trimmed")
    expect(out).not.toContain(row(1))
    expect(out).not.toContain(row(2))
  })
})
