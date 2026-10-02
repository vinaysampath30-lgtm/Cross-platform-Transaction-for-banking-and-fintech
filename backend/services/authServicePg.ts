/**
 * backend/services/authServicePg.ts
 *
 * PostgreSQL-based authentication service.
 * Implements:
 *   - Short-lived access tokens (15 min)
 *   - Long-lived refresh tokens in HttpOnly cookie
 *   - Refresh token rotation
 *   - Session storage in PostgreSQL sessions table
 *   - Token revocation on logout
 */

import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { env } from "../config/env.js";
import { UserPg } from "../db/pg-models/UserPg.js";
import { Session } from "../db/pg-models/Session.js";
import { ActivityLog } from "../db/mongo-models/ActivityLog.js";
import { pgSequelize } from "../db/postgres.js";
import { QueryTypes } from "sequelize";
import type { RegisterInput, LoginInput } from "../validation/schemas.js";

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export interface UserResponse {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface AuthResultPg {
  user: UserResponse;
  accessToken: string;
  refreshToken: string; // raw token â€” caller must set as HttpOnly cookie
  sessionId: string;
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

function generateAccountNumber(): string {
  const rand4 = () => Math.floor(1000 + Math.random() * 9000).toString();
  return `${rand4()}-${rand4()}-${rand4()}-${rand4()}`;
}

export function issueAccessToken(
  userId: string,
  username: string,
  email: string
): string {
  return jwt.sign(
    {
      sub: userId,
      username,
      email,
      tokenType: "access",
      jti: randomUUID(),
    },
    env.accessTokenSecret,
    {
      expiresIn: env.accessTokenExpiry as SignOptions["expiresIn"],
      issuer: "nexuspay",
      audience: "nexuspay-client",
    }
  );
}

async function createSession(
  userId: string,
  meta: { ipAddress?: string; userAgent?: string; deviceName?: string }
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const user = await UserPg.findByPk(userId, {
    attributes: ["id", "username", "email"],
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  );

  const session = await Session.create({
    user_id: userId,
    refresh_token_hash: tokenHash,
    device_name: meta.deviceName ?? null,
    ip_address: meta.ipAddress ?? null,
    user_agent: meta.userAgent ?? null,
    expires_at: expiresAt,
  });

  const accessToken = issueAccessToken(user.id, user.username, user.email);

  return { accessToken, refreshToken: rawRefreshToken, sessionId: session.id };
}

export async function registerUserPg(
  input: RegisterInput,
  reqMeta: { ipAddress?: string; userAgent?: string; deviceName?: string }
): Promise<AuthResultPg> {
  const { firstName, lastName, email, username, password } = input;

  const [existingUser, existingEmail] = await Promise.all([
    UserPg.findOne({ where: { username }, attributes: ["id"] }),
    UserPg.findOne({ where: { email: email.toLowerCase() }, attributes: ["id"] }),
  ]);
  if (existingUser) throw new Error("USERNAME_TAKEN");
  if (existingEmail) throw new Error("EMAIL_EXISTS");

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = randomUUID();
  const accountId = randomUUID();
  const accountNumber = generateAccountNumber();

  await pgSequelize.transaction(async (t) => {
    await pgSequelize.query(
      `INSERT INTO users (id, username, first_name, last_name, email, password_hash,
         kyc_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())`,
      {
        bind: [
          userId,
          username.trim(),
          firstName.trim(),
          lastName?.trim() ?? "",
          email.toLowerCase().trim(),
          passwordHash,
        ],
        transaction: t,
      }
    );
    await pgSequelize.query(
      `INSERT INTO accounts (id, user_id, account_number, balance, currency,
         version_id, created_at, updated_at)
       VALUES ($1, $2, $3, 0, 'USD', 0, NOW(), NOW())`,
      { bind: [accountId, userId, accountNumber], transaction: t }
    );
  });

  const { accessToken, refreshToken, sessionId } = await createSession(
    userId,
    reqMeta
  );

  ActivityLog.create({
    userId,
    eventType: "user.register",
    category: "auth",
    metadata: { username, email: email.toLowerCase() },
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  }).catch((err) => console.error("[auth] ActivityLog create failed:", err));

  return {
    user: {
      id: userId,
      username: username.trim(),
      firstName: firstName.trim(),
      lastName: lastName?.trim() ?? "",
      email: email.toLowerCase(),
    },
    accessToken,
    refreshToken,
    sessionId,
  };
}

export async function loginUserPg(
  input: LoginInput,
  reqMeta: { ipAddress?: string; userAgent?: string; deviceName?: string }
): Promise<AuthResultPg> {
  const { username, password } = input;

  const user = await UserPg.findOne({ where: { username: username.trim() } });
  // Always compare â€” even if user not found â€” to prevent timing attacks
  const hashToCompare =
    user?.password_hash ?? "$2a$12$invalidhashfortimingprevention00000000000000000";
  const match = await bcrypt.compare(password, hashToCompare);
  if (!user || !match) throw new Error("INVALID_CREDENTIALS");

  const { accessToken, refreshToken, sessionId } = await createSession(
    user.id,
    reqMeta
  );

  ActivityLog.create({
    userId: user.id,
    eventType: "user.login",
    category: "auth",
    metadata: { username: user.username },
    ipAddress: reqMeta.ipAddress,
    userAgent: reqMeta.userAgent,
  }).catch((err) => console.error("[auth] ActivityLog create failed:", err));

  return {
    user: {
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
    },
    accessToken,
    refreshToken,
    sessionId,
  };
}

export async function rotateRefreshToken(
  rawRefreshToken: string,
  reqMeta: { ipAddress?: string; userAgent?: string }
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const tokenHash = hashToken(rawRefreshToken);

  const session = await Session.findOne({
    where: { refresh_token_hash: tokenHash, revoked_at: null },
  });

  if (!session || session.expires_at < new Date()) {
    if (session) {
      await session.update({ revoked_at: new Date() });
    }
    throw new Error("INVALID_REFRESH_TOKEN");
  }

  const user = await UserPg.findByPk(session.user_id, {
    attributes: ["id", "username", "email"],
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  // Revoke old session
  await session.update({ revoked_at: new Date() });

  // Issue new session (token rotation)
  const newRawToken = generateRefreshToken();
  const newTokenHash = hashToken(newRawToken);
  const newExpiresAt = new Date(
    Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
  );

  const newSession = await Session.create({
    user_id: user.id,
    refresh_token_hash: newTokenHash,
    ip_address: reqMeta.ipAddress ?? null,
    user_agent: reqMeta.userAgent ?? null,
    expires_at: newExpiresAt,
  });

  const accessToken = issueAccessToken(user.id, user.username, user.email);

  return { accessToken, refreshToken: newRawToken, sessionId: newSession.id };
}

export async function revokeSession(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await Session.update(
    { revoked_at: new Date() },
    { where: { refresh_token_hash: tokenHash, revoked_at: null } }
  );
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await Session.update(
    { revoked_at: new Date() },
    { where: { user_id: userId, revoked_at: null } }
  );
}

export async function createPasswordResetTokenPg(
  email: string
): Promise<string | null> {
  const user = await UserPg.findOne({
    where: { email: email.toLowerCase().trim() },
  });
  if (!user) return null;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

  await pgSequelize.query(
    `UPDATE users SET reset_token = $1, reset_token_expires = $2, updated_at = NOW()
     WHERE id = $3`,
    { bind: [hashedToken, expiresAt, user.id] }
  );

  return rawToken;
}

export async function resetPasswordPg(
  token: string,
  newPassword: string
): Promise<void> {
  const hashedToken = crypto
    .createHash("sha256")
    .update(token.trim())
    .digest("hex");

  const users = await pgSequelize.query<{ id: string }>(
    `SELECT id FROM users WHERE reset_token = $1 AND reset_token_expires > $2`,
    { bind: [hashedToken, Date.now()], type: QueryTypes.SELECT }
  );

  if (!users || users.length === 0) throw new Error("INVALID_OR_EXPIRED_TOKEN");
  const userId = users[0].id;

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pgSequelize.query(
    `UPDATE users SET password_hash = $1, reset_token = NULL,
       reset_token_expires = NULL, updated_at = NOW()
     WHERE id = $2`,
    { bind: [passwordHash, userId] }
  );

  ActivityLog.create({
    userId,
    eventType: "user.password_change",
    category: "auth",
    metadata: { method: "reset" },
  }).catch(() => {});
}
