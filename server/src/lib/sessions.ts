import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db/client.ts";
import { sessions } from "../db/schema.ts";

const DEFAULT_TTL_HOURS = 8;
const DEFAULT_SLIDING = true;

function getTtlMs(): number {
  return (Number(Bun.env.SESSION_TTL_HOURS) || DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
}

function isSlidingEnabled(): boolean {
  const val = Bun.env.SESSION_SLIDING;
  if (val === undefined) return DEFAULT_SLIDING;
  return val !== "false";
}

function expiresAt(): Date {
  return new Date(Date.now() + getTtlMs());
}

export async function createSession(user: {
  userId: string;
  instanceId: string;
  role: string;
  staffbaseSessionHash?: string | null;
}): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(sessions).values({
    id,
    userId: user.userId,
    instanceId: user.instanceId,
    role: user.role,
    expiresAt: expiresAt(),
    createdAt: new Date(),
    staffbaseSessionHash: user.staffbaseSessionHash ?? null,
  });
  return id;
}

export interface Session {
  id: string;
  userId: string;
  instanceId: string;
  role: string;
  expiresAt: Date;
  staffbaseSessionHash: string | null;
}

export async function getSession(sessionId: string): Promise<Session | null> {
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    instanceId: row.instanceId,
    role: row.role,
    expiresAt: row.expiresAt,
    staffbaseSessionHash: row.staffbaseSessionHash ?? null,
  };
}

export async function extendSession(sessionId: string): Promise<void> {
  if (!isSlidingEnabled()) return;
  await db
    .update(sessions)
    .set({ expiresAt: expiresAt() })
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())));
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function cleanExpiredSessions(): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return result.length;
}

export async function deleteUserSessions(userId: string, instanceId: string): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.instanceId, instanceId)))
    .returning({ id: sessions.id });
  return result.length;
}

export async function deleteSessionsByStaffbaseHash(
  staffbaseSessionHash: string,
  instanceId: string
): Promise<number> {
  const result = await db
    .delete(sessions)
    .where(
      and(
        eq(sessions.staffbaseSessionHash, staffbaseSessionHash),
        eq(sessions.instanceId, instanceId)
      )
    )
    .returning({ id: sessions.id });
  return result.length;
}
