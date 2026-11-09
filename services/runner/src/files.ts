import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { FileDocument, FileEntry, FileListing } from "@cloudai/shared"

const textLimit = 1_000_000

export function lexicalInside(root: string, rel: string): string | null {
  const base = path.resolve(root)
  if (rel === "" || rel === ".") return base
  if (rel.includes("\0") || rel.length > 500 || path.isAbsolute(rel)) return null
  const normalized = path.normalize(rel)
  if (normalized.split(path.sep).includes("..")) return null
  const target = path.resolve(base, normalized)
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) return null
  return target
}

export async function listFiles(projectDir: string, rel: string): Promise<FileListing | null> {
  const dir = await existingInside(projectDir, rel)
  if (!dir) return null
  const info = await stat(dir)
  if (!info.isDirectory()) return null
  const names = await readdir(dir)
  const entries: FileEntry[] = []
  for (const name of names) {
    if (entries.length >= 1000) return { entries: sortEntries(entries), truncated: true }
    const child = path.join(dir, name)
    const item = await lstat(child).catch(() => null)
    if (!item) continue
    entries.push({
      name,
      path: relativePath(projectDir, path.join(lexicalInside(projectDir, rel) ?? projectDir, name)),
      kind: item.isDirectory() ? "dir" : "file",
      size: item.isDirectory() ? 0 : item.size,
    })
  }
  return { entries: sortEntries(entries), truncated: names.length > entries.length }
}

export async function readDocument(projectDir: string, rel: string): Promise<FileDocument | "invalid" | "missing"> {
  const target = lexicalInside(projectDir, rel)
  if (!target || target === path.resolve(projectDir)) return "invalid"
  const real = await existingInside(projectDir, rel)
  if (!real) return "missing"
  const info = await stat(real)
  if (!info.isFile()) return "invalid"
  if (info.size > textLimit) {
    return { path: displayPath(rel), size: info.size, binary: false, tooLarge: true, text: null }
  }
  const bytes = await readFile(real)
  if (bytes.subarray(0, 8000).includes(0)) {
    return { path: displayPath(rel), size: info.size, binary: true, tooLarge: false, text: null }
  }
  return {
    path: displayPath(rel),
    size: info.size,
    binary: false,
    tooLarge: false,
    text: bytes.toString("utf8"),
  }
}

export async function prepareFile(projectDir: string, rel: string): Promise<string | null> {
  return writableInside(projectDir, rel)
}

export async function writeDocument(projectDir: string, rel: string, text: string): Promise<"ok" | "invalid" | "large"> {
  if (text.length > textLimit) return "large"
  const target = await writableInside(projectDir, rel)
  if (!target) return "invalid"
  await mkdir(path.dirname(target), { recursive: true })
  const parent = await realpath(path.dirname(target))
  const base = await realpath(projectDir)
  if (!contained(base, parent)) return "invalid"
  await writeFile(path.join(parent, path.basename(target)), text)
  return "ok"
}

export async function readBytes(projectDir: string, rel: string): Promise<{ name: string; bytes: Buffer } | null> {
  const real = await existingInside(projectDir, rel)
  if (!real) return null
  const info = await stat(real)
  if (!info.isFile() || info.size > 20_000_000) return null
  return { name: path.basename(real), bytes: await readFile(real) }
}

async function existingInside(projectDir: string, rel: string): Promise<string | null> {
  const target = lexicalInside(projectDir, rel)
  if (!target) return null
  const base = await realpath(projectDir).catch(() => null)
  if (!base) return null
  const real = await realpath(target).catch(() => null)
  if (!real || !contained(base, real)) return null
  return real
}

async function writableInside(projectDir: string, rel: string): Promise<string | null> {
  const target = lexicalInside(projectDir, rel)
  const base = await realpath(projectDir).catch(() => null)
  if (!target || !base || target === base) return null
  let ancestor = path.dirname(target)
  while (ancestor !== path.dirname(ancestor)) {
    try {
      const real = await realpath(ancestor)
      if (!contained(base, real)) return null
      break
    } catch {
      ancestor = path.dirname(ancestor)
    }
  }
  const parent = path.dirname(target)
  await mkdir(parent, { recursive: true })
  const realParent = await realpath(parent).catch(() => null)
  if (!realParent || !contained(base, realParent)) return null
  const existing = await realpath(target).catch(() => null)
  if (existing) {
    if (!contained(base, existing)) return null
    const info = await stat(existing)
    if (!info.isFile()) return null
    return existing
  }
  return path.join(realParent, path.basename(target))
}

function contained(base: string, target: string): boolean {
  return target === base || target.startsWith(`${base}${path.sep}`)
}

function relativePath(root: string, target: string): string {
  return path.relative(path.resolve(root), target).split(path.sep).join("/")
}

function displayPath(rel: string): string {
  return path.normalize(rel).split(path.sep).join("/")
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1
    return a.name.localeCompare(b.name, "it")
  })
}
