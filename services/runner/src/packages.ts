import { readFile, stat, writeFile } from "node:fs/promises"
import type { PackageManager, ProjectPackage } from "@cloudai/shared"
import { parsePackageSpec } from "@cloudai/shared"
import { runCommand } from "./exec.js"
import { lexicalInside, prepareFile } from "./files.js"

type StoredPackage = {
  manager: PackageManager
  name: string
  spec: string
  error: string | null
}

export async function listPackages(projectDir: string): Promise<ProjectPackage[]> {
  const stored = await readManifest(projectDir)
  const items: ProjectPackage[] = []
  for (const item of stored) items.push({ ...item, installed: await isInstalled(projectDir, item) })
  return items
}

export async function addPackage(projectDir: string, manager: string, spec: string): Promise<ProjectPackage[]> {
  const parsed = parsePackageSpec(manager, spec)
  if (!parsed) throw new Error("Pacchetto non valido")
  const stored = (await readManifest(projectDir)).filter(
    (item) => !(item.manager === parsed.manager && item.name === parsed.name),
  )
  const next: StoredPackage = { ...parsed, error: null }
  try {
    await install(projectDir, next)
  } catch (error) {
    next.error = error instanceof Error ? error.message : "Installazione non riuscita"
  }
  stored.push(next)
  await writeManifest(projectDir, stored)
  return listPackages(projectDir)
}

export async function removePackage(projectDir: string, manager: string, name: string): Promise<ProjectPackage[]> {
  const parsed = parsePackageSpec(manager, name)
  if (!parsed || parsed.name !== name) throw new Error("Pacchetto non valido")
  const stored = await readManifest(projectDir)
  const current = stored.find((item) => item.manager === parsed.manager && item.name === parsed.name)
  if (!current) return listPackages(projectDir)
  try {
    await uninstall(projectDir, current)
  } catch (error) {
    current.error = error instanceof Error ? error.message : "Rimozione non riuscita"
    await writeManifest(projectDir, stored)
    return listPackages(projectDir)
  }
  await writeManifest(
    projectDir,
    stored.filter((item) => !(item.manager === current.manager && item.name === current.name)),
  )
  return listPackages(projectDir)
}

async function install(projectDir: string, item: StoredPackage): Promise<void> {
  if (item.manager === "npm") {
    const result = await runCommand(
      "npm",
      ["install", "--save", "--no-audit", "--no-fund", "--", item.spec],
      projectDir,
      180_000,
    )
    if (result.code !== 0) throw new Error(lastLine(result.stderr) || "npm install non riuscito")
    return
  }
  const venv = await runCommand("python3", ["-m", "venv", ".cloudai/venv"], projectDir, 120_000)
  if (venv.code !== 0) throw new Error(lastLine(venv.stderr) || "Ambiente Python non creato")
  const pip = lexicalInside(projectDir, ".cloudai/venv/bin/pip")
  if (!pip) throw new Error("Percorso pip non valido")
  const result = await runCommand(pip, ["install", item.spec], projectDir, 180_000)
  if (result.code !== 0) throw new Error(lastLine(result.stderr) || "pip install non riuscito")
}

async function uninstall(projectDir: string, item: StoredPackage): Promise<void> {
  if (item.manager === "npm") {
    const result = await runCommand("npm", ["uninstall", "--no-audit", "--no-fund", "--", item.name], projectDir, 180_000)
    if (result.code !== 0) throw new Error(lastLine(result.stderr) || "npm uninstall non riuscito")
    return
  }
  const pip = lexicalInside(projectDir, ".cloudai/venv/bin/pip")
  if (!pip) return
  const result = await runCommand(pip, ["uninstall", "-y", item.name], projectDir, 180_000)
  if (result.code !== 0 && !/not installed/i.test(`${result.stdout}\n${result.stderr}`)) {
    throw new Error(lastLine(result.stderr) || "pip uninstall non riuscito")
  }
}

async function isInstalled(projectDir: string, item: StoredPackage): Promise<boolean> {
  if (item.manager === "npm") {
    const marker = lexicalInside(projectDir, `node_modules/${item.name}/package.json`)
    if (!marker) return false
    return stat(marker).then(() => true, () => false)
  }
  const pip = lexicalInside(projectDir, ".cloudai/venv/bin/pip")
  if (!pip) return false
  const result = await runCommand(pip, ["show", item.name], projectDir, 20_000).catch(() => null)
  return result?.code === 0
}

async function readManifest(projectDir: string): Promise<StoredPackage[]> {
  const target = lexicalInside(projectDir, ".cloudai/packages.json")
  if (!target) return []
  try {
    const parsed = JSON.parse(await readFile(target, "utf8")) as { items?: unknown }
    if (!Array.isArray(parsed.items)) return []
    return parsed.items.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const record = item as { manager?: unknown; name?: unknown; spec?: unknown; error?: unknown }
      const parsedItem = parsePackageSpec(String(record.manager), String(record.spec ?? ""))
      if (!parsedItem || parsedItem.name !== record.name) return []
      const error = typeof record.error === "string" && record.error.trim() ? record.error.slice(0, 240) : null
      return [{ ...parsedItem, error }]
    })
  } catch {
    return []
  }
}

async function writeManifest(projectDir: string, items: StoredPackage[]): Promise<void> {
  const target = await prepareFile(projectDir, ".cloudai/packages.json")
  if (!target) throw new Error("Percorso non valido")
  await writeFile(target, `${JSON.stringify({ items }, null, 2)}\n`, "utf8")
}

function lastLine(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 240) ?? ""
}
