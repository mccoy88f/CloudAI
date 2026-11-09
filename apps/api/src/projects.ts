import type { ProjectMember, ProjectRole, ProjectSummary } from "@cloudai/shared"
import { randomUUID } from "node:crypto"
import { findUserByEmail } from "./accounts.js"
import { sql } from "./db.js"

const runnerUrl = process.env.RUNNER_URL ?? "http://runner:4000"

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await sql<{ id: string; name: string; role: ProjectRole }[]>`
    select p.id, p.name, m.role
    from projects p
    join memberships m on m.project_id = p.id
    where m.user_id = ${userId}
    order by p.created_at desc
  `
  return rows.map(toSummary)
}

export async function projectRole(projectId: string, userId: string): Promise<ProjectRole | null> {
  const rows = await sql<{ role: ProjectRole }[]>`
    select role from memberships
    where project_id = ${projectId} and user_id = ${userId}
  `
  return rows[0]?.role ?? null
}

export async function createProject(userId: string, name: string): Promise<ProjectSummary> {
  const id = randomUUID()
  await ensureProjectDir(id)
  const base = slugify(name)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`
    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into projects (id, name, slug, created_by)
          values (${id}, ${name}, ${slug}, ${userId})
        `
        await tx`
          insert into memberships (project_id, user_id, role)
          values (${id}, ${userId}, 'owner')
        `
      })
      return { id, name, role: "owner", canWrite: true }
    } catch (error) {
      if (!isUnique(error)) throw error
    }
  }
  throw new Error("Nome progetto non disponibile")
}

export async function renameProject(projectId: string, name: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update projects set name = ${name} where id = ${projectId} returning id
  `
  return Boolean(rows[0])
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from projects where id = ${projectId} returning id
  `
  if (!rows[0]) return false
  try {
    await removeProjectDir(projectId)
  } catch {
    // La riga è già stata tolta. La cartella resta sul volume se il runner non risponde.
  }
  return true
}

export async function listMembers(projectId: string): Promise<ProjectMember[]> {
  return sql<ProjectMember[]>`
    select u.id, u.email, m.role
    from memberships m
    join users u on u.id = m.user_id
    where m.project_id = ${projectId}
    order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, u.email
  `
}

export async function addMember(
  projectId: string,
  email: string,
  role: Exclude<ProjectRole, "owner">,
): Promise<ProjectMember | "missing" | "exists"> {
  const user = await findUserByEmail(email)
  if (!user) return "missing"
  try {
    await sql`
      insert into memberships (project_id, user_id, role)
      values (${projectId}, ${user.id}, ${role})
    `
  } catch (error) {
    if (isUnique(error)) return "exists"
    throw error
  }
  return { id: user.id, email: user.email, role }
}

export async function updateMemberRole(
  projectId: string,
  userId: string,
  role: Exclude<ProjectRole, "owner">,
): Promise<boolean> {
  const rows = await sql<{ user_id: string }[]>`
    update memberships
    set role = ${role}
    where project_id = ${projectId} and user_id = ${userId} and role <> 'owner'
    returning user_id
  `
  return Boolean(rows[0])
}

export async function removeMember(projectId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ user_id: string }[]>`
    delete from memberships
    where project_id = ${projectId} and user_id = ${userId} and role <> 'owner'
    returning user_id
  `
  return Boolean(rows[0])
}

function toSummary(row: { id: string; name: string; role: ProjectRole }): ProjectSummary {
  return { ...row, canWrite: row.role === "owner" || row.role === "editor" }
}

function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return slug || "progetto"
}

async function ensureProjectDir(id: string): Promise<void> {
  const response = await fetch(`${runnerUrl}/projects/${id}`, { method: "POST" })
  if (!response.ok) throw new Error("Il runner non ha creato la cartella del progetto")
}

async function removeProjectDir(id: string): Promise<void> {
  const response = await fetch(`${runnerUrl}/projects/${id}`, { method: "DELETE" })
  if (!response.ok) throw new Error("Il runner non ha rimosso la cartella del progetto")
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505"
}
