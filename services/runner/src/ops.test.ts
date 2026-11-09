import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { parsePackageSpec, parseRepo, splitCommand } from "@cloudai/shared"
import { runCommand } from "./exec.js"
import { commitAll, gitSnapshot, headerArgs, publicGitError } from "./git.js"
import { matchPreview, startPreview, stopPreview } from "./previews.js"

test("repository, package and command parsers reject shells and keep private names", () => {
  assert.deepEqual(parseRepo("acme/secret", null), { owner: "acme", name: "secret" })
  assert.deepEqual(parseRepo("https://github.com/acme/secret.git", null), { owner: "acme", name: "secret" })
  assert.deepEqual(parseRepo("secret", "acme"), { owner: "acme", name: "secret" })
  assert.equal(parseRepo("acme/secret;rm", null), null)
  assert.deepEqual(parsePackageSpec("npm", "@scope/pkg@1.2.3"), { manager: "npm", name: "@scope/pkg", spec: "@scope/pkg@1.2.3" })
  assert.deepEqual(parsePackageSpec("pip", "requests==2.31.0"), { manager: "pip", name: "requests", spec: "requests==2.31.0" })
  assert.equal(parsePackageSpec("npm", "zod;rm"), null)
  assert.deepEqual(splitCommand('npm run dev'), ["npm", "run", "dev"])
  assert.equal(splitCommand("bash -c id"), null)
  assert.equal(splitCommand("npm install foo && rm -rf /"), null)
})

test("git errors do not keep the installation token", () => {
  assert.equal(publicGitError("fatal: ghs_supersecretvalue"), "fatal: [omesso]")
  assert.equal(publicGitError("AUTHORIZATION: basic abc"), "AUTHORIZATION: [omesso]")
})

test("clone credentials stay out of git config and the commit keeps the author", async () => {
  const version = await runCommand("git", ["--version"], tmpdir()).catch(() => null)
  if (!version || version.code !== 0) return
  const root = await mkdtemp(path.join(tmpdir(), "cloudai-git-"))
  const source = path.join(root, "source")
  const dest = path.join(root, "dest")
  await mkdir(source)
  await mkdir(dest)
  const token = "ghs_supersecretvalue"
  await runCommand("git", ["init", "-b", "main"], source)
  await writeFile(path.join(source, "a.txt"), "a\n")
  await runCommand("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "add", "a.txt"], source)
  await runCommand("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"], source)
  const cloned = await runCommand("git", [...headerArgs(token), "clone", "--", source, "."], dest)
  assert.equal(cloned.code, 0, cloned.stderr)
  const config = await runCommand("git", ["config", "--local", "--list"], dest)
  assert.equal(config.stdout.includes(token), false)
  assert.equal(config.stdout.includes("extraheader"), false)
  await writeFile(path.join(dest, "b.txt"), "b\n")
  await commitAll(dest, "seconda", "ada", "ada@example.com")
  const author = await runCommand("git", ["log", "-1", "--format=%an %ae"], dest)
  assert.equal(author.stdout.trim(), "ada ada@example.com")
  const snapshot = await gitSnapshot(dest)
  assert.equal(snapshot.branch, "main")
  assert.equal(snapshot.dirty, false)
})

test("a preview stays up until it is stopped", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "cloudai-preview-"))
  const host = "demo.preview.test"
  const started = await startPreview({
    projectId: "11111111-1111-4111-8111-111111111111",
    projectDir: dir,
    host,
    port: 8765,
    command: 'node -e "setInterval(function(){}, 1000)"',
  })
  assert.equal(started.running, true)
  assert.equal(matchPreview("demo.preview.test")?.port, 8765)
  assert.equal(matchPreview("127.0.0.1:4000"), null)
  stopPreview(host)
  assert.equal(matchPreview(host), null)
})
