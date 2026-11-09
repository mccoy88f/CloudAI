import { parseRepo } from "@cloudai/shared"
import { decryptSecret } from "./crypto.js"
import { readState } from "./db.js"
import { signAppJwt } from "./github-jwt.js"

export function readRepository(value: unknown, organization: string | null): { owner: string; name: string } | null {
  if (typeof value !== "string" || !value.trim()) return null
  return parseRepo(value, organization)
}

export async function installationToken(owner: string, name: string): Promise<string> {
  const jwt = await appJwt()
  const installation = await github(`/repos/${owner}/${name}/installation`, jwt)
  const id = installation.id
  if (typeof id !== "number") throw new Error("La GitHub App non è installata su questo repository")
  const minted = await github(`/app/installations/${id}/access_tokens`, jwt, { method: "POST" })
  if (typeof minted.token !== "string" || !minted.token) throw new Error("GitHub non ha emesso un token")
  return minted.token
}

export async function repositoryDefaultBranch(owner: string, name: string, token: string): Promise<string> {
  const repo = await github(`/repos/${owner}/${name}`, token)
  if (typeof repo.default_branch !== "string" || !repo.default_branch) throw new Error("Branch predefinito assente")
  return repo.default_branch
}

export async function openPullRequest(
  owner: string,
  name: string,
  token: string,
  input: { title: string; head: string; base: string },
): Promise<string> {
  if (input.head === input.base) throw new Error("Crea un branch prima di aprire la pull request")
  const created = await github(`/repos/${owner}/${name}/pulls`, token, {
    method: "POST",
    body: JSON.stringify({ title: input.title, head: input.head, base: input.base }),
  })
  if (typeof created.html_url !== "string") throw new Error("Pull request non creata")
  return created.html_url
}

async function appJwt(): Promise<string> {
  const appId = await readState("github_app_id")
  const encrypted = await readState("github_private_key")
  if (!appId || !encrypted) throw new Error("Configura la GitHub App")
  return signAppJwt(appId, decryptSecret(encrypted))
}

async function github(path: string, token: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "CloudAI",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  })
  const body = (await response.json().catch(() => ({}))) as { message?: unknown; id?: unknown; token?: unknown; default_branch?: unknown; html_url?: unknown }
  if (response.status === 404) throw new Error("La GitHub App non è installata su questo repository")
  if (response.status === 422 && typeof body.message === "string" && /pull request/i.test(body.message)) {
    throw new Error("Esiste già una pull request per questo branch")
  }
  if (!response.ok) throw new Error("GitHub ha rifiutato la richiesta")
  return body
}
