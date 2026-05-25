// Pure / shared between plugin and tests so they cannot drift.
import { readFile } from "node:fs/promises"
import { writeFileAtomic } from "./io"

export type LockInfo = {
  sessionId: string
  pid: number
  createdAt: number
}

// 1 hour. A stale lock means the owning process likely died without cleanup.
export const STALE_LOCK_MS = 1000 * 60 * 60

export async function readLock(path: string): Promise<LockInfo | null> {
  try {
    const raw = await readFile(path, "utf-8")
    const obj = JSON.parse(raw)
    if (
      typeof obj.sessionId === "string" &&
      typeof obj.pid === "number" &&
      typeof obj.createdAt === "number"
    ) {
      return obj
    }
    return null
  } catch {
    return null
  }
}

export async function writeLock(path: string, info: LockInfo): Promise<void> {
  await writeFileAtomic(path, JSON.stringify(info))
}

// process.kill(pid, 0) does not actually kill — it only checks whether the
// signal can be delivered. Throws ESRCH if the process is gone.
export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    // EPERM means the process exists but we lack permission — still alive.
    return code === "EPERM"
  }
}

export function isLockStale(info: LockInfo, now: number = Date.now()): boolean {
  return now - info.createdAt > STALE_LOCK_MS
}

export function isLockHeldByOther(
  info: LockInfo | null,
  ownSessionId: string,
  ownPid: number,
  now: number = Date.now(),
): boolean {
  if (info === null) return false
  if (info.sessionId === ownSessionId) return false
  if (info.pid === ownPid) return false
  if (isLockStale(info, now)) return false
  return isProcessAlive(info.pid)
}
