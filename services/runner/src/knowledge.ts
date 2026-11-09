import { appendFile, readFile, stat, writeFile } from "node:fs/promises"
import { prepareFile } from "./files.js"

const memoryBody = `# Memoria del progetto

Decisioni e vincoli da tenere a ogni motore. Il giornale delle conversazioni sta in \`.cloudai/journal/\`.
`

const memoryTemplate = `---
title: Memoria
---

${memoryBody}`

const tails = new Map<string, Promise<unknown>>()

export function romeStamp(at: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  return { date: `${read("year")}-${read("month")}-${read("day")}`, time: `${read("hour")}:${read("minute")}` }
}

export function journalBlock(time: string, who: string, text: string): string {
  const label = who.replace(/[\r\n]+/g, " ").trim().slice(0, 80) || "assistente"
  return `## ${time} ${label}\n\n${text.trim().slice(0, 20_000)}\n\n`
}

export function memoryExcerpt(raw: string): string | null {
  const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim()
  if (!body || body === memoryBody.trim()) return null
  return body.slice(0, 4000)
}

export function ensureProjectKnowledge(projectDir: string): Promise<void> {
  return queue(projectDir, () => writeKnowledge(projectDir))
}

export function appendArchive(projectDir: string, input: { at: string; who: string; text: string }): Promise<void> {
  return queue(projectDir, async () => {
    await writeKnowledge(projectDir)
    const at = new Date(input.at)
    const stamp = romeStamp(Number.isNaN(at.getTime()) ? new Date() : at)
    const file = await prepareFile(projectDir, `.cloudai/journal/${stamp.date}.md`)
    if (!file) return
    let prefix = ""
    try {
      await stat(file)
    } catch {
      prefix = `---\ndate: ${stamp.date}\n---\n\n`
    }
    await appendFile(file, `${prefix}${journalBlock(stamp.time, input.who, input.text)}`, "utf8")
  })
}

export async function projectMemory(projectDir: string): Promise<string | null> {
  const file = await prepareFile(projectDir, ".cloudai/memoria.md").catch(() => null)
  if (!file) return null
  try {
    return memoryExcerpt(await readFile(file, "utf8"))
  } catch {
    return null
  }
}

async function writeKnowledge(projectDir: string): Promise<void> {
  const memory = await prepareFile(projectDir, ".cloudai/memoria.md")
  const journal = await prepareFile(projectDir, ".cloudai/journal/.keep")
  const gitignore = await prepareFile(projectDir, ".gitignore")
  if (!memory || !journal || !gitignore) return
  try {
    await stat(memory)
  } catch {
    await writeFile(memory, memoryTemplate, "utf8")
  }
  let current = ""
  try {
    current = await readFile(gitignore, "utf8")
  } catch {
    current = ""
  }
  const wanted = [".cloudai/journal/", ".cloudai/venv/", "node_modules/"]
  const present = new Set(current.split("\n").map((item) => item.trim()))
  const missing = wanted.filter((item) => !present.has(item))
  if (missing.length === 0) return
  const next = current.length === 0 ? `${missing.join("\n")}\n` : `${current.replace(/\n?$/, "\n")}${missing.join("\n")}\n`
  await writeFile(gitignore, next)
}

function queue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  const run = previous.then(job, job)
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}
