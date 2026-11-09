import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from "node:crypto"
import { promisify } from "node:util"

const scryptAsync = promisify(scrypt)

function secretKey(): Buffer {
  const secret = process.env.APP_SECRET
  if (!secret || secret.length < 16) {
    throw new Error("APP_SECRET is required")
  }
  return createHash("sha256").update(secret).digest()
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function newToken(): string {
  return randomBytes(32).toString("base64url")
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = (await scryptAsync(password, salt, 64)) as Buffer
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, saltB64, keyB64] = stored.split("$")
  if (kind !== "scrypt" || !saltB64 || !keyB64) return false
  const salt = Buffer.from(saltB64, "base64url")
  const expected = Buffer.from(keyB64, "base64url")
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString("base64url")
}

export function decryptSecret(payload: string): string {
  const buffer = Buffer.from(payload, "base64url")
  const iv = buffer.subarray(0, 12)
  const tag = buffer.subarray(12, 28)
  const encrypted = buffer.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}
