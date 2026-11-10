import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { loginView, openLogin, readLogin } from "./login.js"

test("login view keeps the address and drops the color codes", () => {
  const view = loginView("\u001b[31mopen https://example.com/oauth?code=1\u001b[0m")
  assert.equal(view.url, "https://example.com/oauth?code=1")
  assert.equal(view.output.includes("\u001b"), false)
})

test("the login bridge prints the address from the CLI", async () => {
  const home = await mkdtemp(`${tmpdir()}/cloudai-login-`)
  const id = "11111111-1111-4111-8111-111111111111"
  try {
    openLogin(id, home, "python3", ["-c", "print('https://example.com/login')"])
    const state = await waitFor(id)
    assert.equal(state.url, "https://example.com/login")
    assert.equal(state.exitCode, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test("gemini login completes when the account file appears", async () => {
  const home = await mkdtemp(`${tmpdir()}/cloudai-gemini-`)
  const id = "22222222-2222-4222-8222-222222222222"
  try {
    openLogin(id, home, "python3", ["-c", "import time; time.sleep(5)"])
    await mkdir(path.join(home, ".gemini"), { recursive: true })
    await writeFile(path.join(home, ".gemini", "gemini-credentials.json"), "signed")
    const state = await waitFor(id)
    assert.equal(state.exitCode, 0)
    assert.equal(state.running, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

async function waitFor(id: string) {
  const started = Date.now()
  let state = readLogin(id)
  while (state.exitCode === null && Date.now() - started < 5000) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    state = readLogin(id)
  }
  return state
}
