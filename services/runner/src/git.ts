import { readBranchName } from "@cloudai/shared"
import { runCommand } from "./exec.js"

const remotePattern = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/

export function headerArgs(token: string): string[] {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64")
  return ["-c", `http.extraheader=AUTHORIZATION: basic ${basic}`]
}

export function publicGitError(text: string): string {
  return text
    .replace(/AUTHORIZATION:[^\n]*/gi, "AUTHORIZATION: [omesso]")
    .replace(/\b(?:ghs|github_pat)_[A-Za-z0-9_]+\b/g, "[omesso]")
    .trim()
    .slice(0, 400)
}

export async function cloneRepo(projectDir: string, remote: string, token: string): Promise<string> {
  if (!remotePattern.test(remote) || !token.trim() || /\s/.test(token)) throw new Error("Repository non valido")
  const result = await runCommand("git", [...headerArgs(token), "clone", "--", remote, "."], projectDir, 120_000)
  if (result.code !== 0) throw new Error(publicGitError(result.stderr) || "Clone non riuscito")
  return currentBranch(projectDir)
}

export async function gitSnapshot(projectDir: string): Promise<{ branch: string; dirty: boolean; files: string[] }> {
  const status = await runCommand("git", ["status", "--porcelain"], projectDir)
  if (status.code !== 0) throw new Error("Questo progetto non è un repository git")
  const files = status.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .slice(0, 40)
  return { branch: await currentBranch(projectDir), dirty: files.length > 0, files }
}

export async function checkoutBranch(projectDir: string, name: string): Promise<string> {
  if (!readBranchName(name)) throw new Error("Nome branch non valido")
  const exists = await runCommand("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], projectDir)
  const args = exists.code === 0 ? ["checkout", name] : ["checkout", "-b", name]
  const result = await runCommand("git", args, projectDir)
  if (result.code !== 0) throw new Error(publicGitError(result.stderr) || "Branch non creato")
  return currentBranch(projectDir)
}

export async function commitAll(
  projectDir: string,
  message: string,
  authorName: string,
  authorEmail: string,
): Promise<void> {
  if (!message.trim() || message.length > 2000 || /[\r\n\0]/.test(message)) throw new Error("Messaggio non valido")
  if (!/^[A-Za-z0-9._+-]{1,64}$/.test(authorName)) throw new Error("Autore non valido")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) throw new Error("Autore non valido")
  const add = await runCommand("git", ["add", "-A"], projectDir)
  if (add.code !== 0) throw new Error(publicGitError(add.stderr) || "git add non riuscito")
  const commit = await runCommand(
    "git",
    ["-c", `user.name=${authorName}`, "-c", `user.email=${authorEmail}`, "commit", "-m", message.trim()],
    projectDir,
  )
  if (commit.code !== 0) {
    const text = `${commit.stdout}\n${commit.stderr}`
    if (/nothing to commit|no changes added|nessun cambiamento/i.test(text)) throw new Error("Nessuna modifica da salvare")
    throw new Error(publicGitError(commit.stderr) || "Commit non riuscito")
  }
}

export async function pushHead(projectDir: string, token: string): Promise<void> {
  if (!token.trim() || /\s/.test(token)) throw new Error("Token assente")
  const result = await runCommand("git", [...headerArgs(token), "push", "-u", "origin", "HEAD"], projectDir, 120_000)
  if (result.code !== 0) throw new Error(publicGitError(result.stderr) || "Push non riuscito")
}

async function currentBranch(projectDir: string): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], projectDir)
  const branch = result.stdout.trim()
  if (result.code !== 0 || !branch || branch === "HEAD") throw new Error("Branch assente")
  return branch
}
