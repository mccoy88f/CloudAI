import assert from "node:assert/strict"
import test from "node:test"

process.env.APP_SECRET = "test-secret-value"

const { decryptSecret, encryptSecret, hashPassword, verifyPassword } = await import("./crypto.js")

test("password roundtrip", async () => {
  const stored = await hashPassword("correct horse")
  assert.equal(await verifyPassword("correct horse", stored), true)
  assert.equal(await verifyPassword("wrong horse", stored), false)
})

test("secret roundtrip", () => {
  const encrypted = encryptSecret("-----BEGIN PRIVATE KEY-----\nabc\n")
  assert.equal(decryptSecret(encrypted), "-----BEGIN PRIVATE KEY-----\nabc\n")
  assert.equal(encrypted.includes("PRIVATE KEY"), false)
})
