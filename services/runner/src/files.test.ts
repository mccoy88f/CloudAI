import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { lexicalInside, listFiles, readDocument, writeDocument } from "./files.js"
import { appendArchive, ensureProjectKnowledge, journalBlock, memoryExcerpt, projectMemory, romeStamp } from "./knowledge.js"

test("paths stay inside the project", () => {
  const root = "/workspaces/11111111-1111-1111-1111-111111111111"
  assert.equal(lexicalInside(root, "."), path.resolve(root))
  assert.equal(lexicalInside(root, ".cloudai/memoria.md"), path.resolve(root, ".cloudai/memoria.md"))
  assert.equal(lexicalInside(root, "../secret"), null)
  assert.equal(lexicalInside(root, "src/../../etc/passwd"), null)
  assert.equal(lexicalInside(root, "/etc/passwd"), null)
})

test("rome time labels the journal", () => {
  assert.deepEqual(romeStamp(new Date("2026-11-09T21:30:00.000Z")), { date: "2026-11-09", time: "22:30" })
  assert.match(journalBlock("22:30", "utente", "allinea il login"), /^## 22:30 utente\n\nallinea il login\n\n$/)
})

test("the default memory is not injected", () => {
  const template = `---\ntitle: Memoria\n---\n\n# Memoria del progetto\n\nDecisioni e vincoli da tenere a ogni motore. Il giornale delle conversazioni sta in \`.cloudai/journal/\`.\n`
  assert.equal(memoryExcerpt(template), null)
  assert.match(memoryExcerpt(`${template}\nUsa pnpm.\n`) ?? "", /Usa pnpm/)
})

test("archive, memory and writes stay in the project folder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "cloudai-"))
  const outside = await mkdtemp(path.join(tmpdir(), "cloudai-out-"))
  await symlink(outside, path.join(root, "uscita"))
  await ensureProjectKnowledge(root)
  await appendArchive(root, { at: "2026-11-09T21:30:00.000Z", who: "utente", text: "prima" })
  await appendArchive(root, { at: "2026-11-09T21:31:00.000Z", who: "claude", text: "dopo" })
  const journal = await readFile(path.join(root, ".cloudai/journal/2026-11-09.md"), "utf8")
  assert.equal(journal.match(/---/g)?.length, 2)
  assert.match(journal, /## 22:30 utente/)
  assert.match(journal, /## 22:31 claude/)
  assert.match(await readFile(path.join(root, ".gitignore"), "utf8"), /^\.cloudai\/journal\/\n/)
  assert.equal(await projectMemory(root), null)
  await writeFile(path.join(root, ".cloudai/memoria.md"), "# Memoria del progetto\n\nLa porta è 8080.\n")
  assert.match((await projectMemory(root)) ?? "", /8080/)
  assert.equal(await writeDocument(root, "src/app.ts", "export const n = 1\n"), "ok")
  const document = await readDocument(root, "src/app.ts")
  if (typeof document !== "object") throw new Error("file atteso")
  assert.equal(document.text, "export const n = 1\n")
  const rootListing = await listFiles(root, "")
  assert.equal(rootListing?.entries.find((entry) => entry.name === "src")?.path, "src")
  const srcListing = await listFiles(root, "src")
  assert.equal(srcListing?.entries[0]?.path, "src/app.ts")
  assert.equal(await writeDocument(root, "uscita/pwn.txt", "no"), "invalid")
  await mkdir(outside, { recursive: true })
  const leaked = await readFile(path.join(outside, "pwn.txt"), "utf8").catch(() => "")
  assert.equal(leaked, "")
})
