import type { PublicUser, UserRole } from "@cloudai/shared"
import { sql } from "./db.js"
import { hashToken, newToken } from "./crypto.js"

type UserRecord = PublicUser & { passwordHash: string }

export async function countUsers(): Promise<number> {
  const rows = await sql<{ count: string }[]>`select count(*)::text as count from users`
  return Number(rows[0]?.count ?? 0)
}

export async function insertUser(
  email: string,
  passwordHash: string,
  role: UserRole,
): Promise<PublicUser> {
  const rows = await sql<PublicUser[]>`
    insert into users (email, password_hash, role)
    values (${email}, ${passwordHash}, ${role})
    returning id, email, role
  `
  const user = rows[0]
  if (!user) throw new Error("user insert failed")
  return user
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const rows = await sql<UserRecord[]>`
    select id, email, role, password_hash as "passwordHash"
    from users
    where email = ${email}
  `
  return rows[0] ?? null
}

export async function findUserBySession(token: string): Promise<PublicUser | null> {
  const rows = await sql<PublicUser[]>`
    select u.id, u.email, u.role
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
      and s.expires_at > now()
  `
  return rows[0] ?? null
}

export async function createSession(userId: string): Promise<string> {
  const token = newToken()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  await sql`
    insert into sessions (token_hash, user_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${expires})
  `
  return token
}

export async function deleteSession(token: string): Promise<void> {
  await sql`delete from sessions where token_hash = ${hashToken(token)}`
}

export async function createInvite(email: string, createdBy: string): Promise<string> {
  const token = newToken()
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await sql`
    insert into invites (email, token_hash, created_by, expires_at)
    values (${email}, ${hashToken(token)}, ${createdBy}, ${expires})
  `
  return token
}

export async function acceptInvite(
  token: string,
  passwordHash: string,
): Promise<PublicUser | "invalid" | "taken"> {
  try {
    return await acceptInviteOnce(token, passwordHash)
  } catch (error) {
    if (isUniqueViolation(error)) return "taken"
    throw error
  }
}

async function acceptInviteOnce(
  token: string,
  passwordHash: string,
): Promise<PublicUser | "invalid" | "taken"> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ id: string; email: string }[]>`
      select id, email
      from invites
      where token_hash = ${hashToken(token)}
        and accepted_at is null
        and expires_at > now()
      for update
    `
    const invite = rows[0]
    if (!invite) return "invalid"

    const existing = await tx<{ id: string }[]>`
      select id from users where email = ${invite.email}
    `
    if (existing[0]) return "taken"

    const users = await tx<PublicUser[]>`
      insert into users (email, password_hash, role)
      values (${invite.email}, ${passwordHash}, 'member')
      returning id, email, role
    `
    const user = users[0]
    if (!user) throw new Error("user insert failed")

    const updated = await tx<{ id: string }[]>`
      update invites
      set accepted_at = now()
      where id = ${invite.id} and accepted_at is null
      returning id
    `
    if (!updated[0]) return "invalid"
    return user
  })
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
}
