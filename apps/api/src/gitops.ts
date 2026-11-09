import type { GitSnapshot, ProjectPackage } from "@cloudai/shared"
import { parsePackageSpec, readBranchName } from "@cloudai/shared"
import { installationToken, openPullRequest, repositoryDefaultBranch } from "./github.js"
import { projectRepo, setBranch } from "./projects.js"
import { callRunner } from "./runner.js"

export async function listProjectPackages(projectId: string): Promise<ProjectPackage[]> {
  return callRunner<ProjectPackage[]>(`/projects/${projectId}/packages`)
}

export async function addProjectPackage(projectId: string, manager: unknown, spec: unknown): Promise<ProjectPackage[]> {
  const parsed = parsePackageSpec(typeof manager === "string" ? manager : "", typeof spec === "string" ? spec : "")
  if (!parsed) throw new Error("Pacchetto non valido")
  return callRunner<ProjectPackage[]>(`/projects/${projectId}/packages`, {
    method: "POST",
    body: JSON.stringify({ manager: parsed.manager, spec: parsed.spec }),
  })
}

export async function removeProjectPackage(projectId: string, manager: unknown, name: unknown): Promise<ProjectPackage[]> {
  const parsed = parsePackageSpec(typeof manager === "string" ? manager : "", typeof name === "string" ? name : "")
  if (!parsed || typeof name !== "string" || parsed.name !== name) throw new Error("Pacchetto non valido")
  return callRunner<ProjectPackage[]>(`/projects/${projectId}/packages`, {
    method: "DELETE",
    body: JSON.stringify({ manager: parsed.manager, name: parsed.name }),
  })
}

export async function projectGit(projectId: string): Promise<GitSnapshot> {
  const repo = await requireRepo(projectId)
  const snapshot = await callRunner<{ branch: string; dirty: boolean; files: string[] }>(`/projects/${projectId}/git`)
  if (snapshot.branch !== repo.branch) await setBranch(projectId, snapshot.branch)
  return { repo: `${repo.owner}/${repo.name}`, ...snapshot }
}

export async function projectBranch(projectId: string, name: unknown): Promise<GitSnapshot> {
  const branch = typeof name === "string" ? readBranchName(name) : null
  if (!branch) throw new Error("Nome branch non valido")
  await requireRepo(projectId)
  const checked = await callRunner<{ branch: string }>(`/projects/${projectId}/git/branch`, {
    method: "POST",
    body: JSON.stringify({ name: branch }),
  })
  await setBranch(projectId, checked.branch)
  return projectGit(projectId)
}

export async function projectCommitAndPush(
  projectId: string,
  message: unknown,
  authorEmail: string,
): Promise<GitSnapshot> {
  const text = readLine(message, 2000)
  if (!text) throw new Error("Scrivi un messaggio di commit")
  const repo = await requireRepo(projectId)
  const authorName = authorOf(authorEmail)
  const token = await installationToken(repo.owner, repo.name)
  try {
    await callRunner(`/projects/${projectId}/git/commit`, {
      method: "POST",
      body: JSON.stringify({ message: text, authorName, authorEmail }),
    })
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Nessuna modifica da salvare") throw error
  }
  await callRunner(`/projects/${projectId}/git/push`, {
    method: "POST",
    body: JSON.stringify({ token }),
  })
  return projectGit(projectId)
}

export async function projectPullRequest(projectId: string, title: unknown): Promise<{ url: string }> {
  const text = readLine(title, 200)
  if (!text) throw new Error("Scrivi il titolo della pull request")
  const repo = await requireRepo(projectId)
  const snapshot = await projectGit(projectId)
  const token = await installationToken(repo.owner, repo.name)
  const base = await repositoryDefaultBranch(repo.owner, repo.name, token)
  const url = await openPullRequest(repo.owner, repo.name, token, { title: text, head: snapshot.branch, base })
  return { url }
}

async function requireRepo(projectId: string) {
  const repo = await projectRepo(projectId)
  if (!repo) throw new Error("Questo progetto non ha un repository")
  return repo
}

function authorOf(email: string): string {
  const local = email.split("@")[0] ?? ""
  return /^[A-Za-z0-9._+-]{1,64}$/.test(local) ? local : "cloudai"
}

function readLine(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (!text || text.length > max || /[\r\n\0]/.test(text)) return null
  return text
}
