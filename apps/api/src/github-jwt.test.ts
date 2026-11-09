import assert from "node:assert/strict"
import { generateKeyPairSync, createVerify } from "node:crypto"
import test from "node:test"
import { signAppJwt } from "./github-jwt.js"

test("the app jwt is RS256 and names the app", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString()
  const now = 1_700_000_000
  const token = signAppJwt("12345", pem.replace(/\n/g, "\\n"), now)
  const [header, payload, signature] = token.split(".")
  if (!header || !payload || !signature) throw new Error("jwt incompleto")
  const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString()) as { alg: string }
  const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString()) as { iss: string; iat: number; exp: number }
  assert.equal(decodedHeader.alg, "RS256")
  assert.equal(decodedPayload.iss, "12345")
  assert.equal(decodedPayload.iat, now - 60)
  assert.equal(decodedPayload.exp, now + 540)
  const verifier = createVerify("RSA-SHA256")
  verifier.update(`${header}.${payload}`)
  verifier.end()
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true)
})
