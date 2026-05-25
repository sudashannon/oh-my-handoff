import { writeFile, rename, unlink } from "node:fs/promises"

// rename within the same dir is atomic on POSIX — readers see old-or-new, never torn.
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 10)}`
  try {
    await writeFile(tmp, content)
    await rename(tmp, path)
  } catch (err) {
    try { await unlink(tmp) } catch {}
    throw err
  }
}
