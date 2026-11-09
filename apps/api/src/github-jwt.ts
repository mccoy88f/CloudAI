import { createSign } from "node:crypto"

export function signAppJwt(appId: string, privateKey: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))
  const payload = base64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }))
  const data = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(data)
  signer.end()
  return `${data}.${signer.sign(normalizeKey(privateKey)).toString("base64url")}`
}

function normalizeKey(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url")
}
