/**
 * backend/services/otpService.ts
 *
 * Email OTP service for transaction confirmation and MFA.
 * OTP codes are:
 *   - 6-digit numeric
 *   - Expire in 10 minutes
 *   - Maximum 3 verification attempts
 *   - Stored as SHA-256 hash only (raw code never persisted)
 */

import crypto from "crypto";
import { randomUUID } from "crypto";
import { pgSequelize } from "../db/postgres.js";
import { QueryTypes } from "sequelize";
import { sendOtpEmail } from "../email/mailer.js";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 3;

function generateOtp(): string {
  // Cryptographically random 6-digit code, zero-padded
  const n = crypto.randomInt(100000, 999999);
  return n.toString();
}

function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export type OtpPurpose = "transfer" | "login_mfa" | "password_reset";

/**
 * Create a new OTP challenge and send via email.
 * Returns the challenge ID to include in the subsequent verify request.
 * The raw OTP is never logged or stored.
 */
export async function createOtpChallenge(
  userId: string,
  userEmail: string,
  purpose: OtpPurpose,
  context?: Record<string, unknown>
): Promise<string> {
  const rawOtp = generateOtp();
  const otpHash = hashOtp(rawOtp);
  const challengeId = randomUUID();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await pgSequelize.query(
    `INSERT INTO otp_challenges (id, user_id, otp_hash, purpose, context, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5::JSONB, $6, NOW())`,
    {
      bind: [
        challengeId,
        userId,
        otpHash,
        purpose,
        JSON.stringify(context ?? {}),
        expiresAt,
      ],
    }
  );

  // Send OTP via email. Never log the raw OTP value.
  await sendOtpEmail(userEmail, rawOtp, purpose).catch((err: Error) => {
    console.error("[otp] Failed to send OTP email:", err.message);
    // Don't throw â€” challenge is still created; user can request resend
  });

  console.log(
    `[otp] Challenge created userId=${userId} purpose=${purpose} challengeId=${challengeId}`
  );
  return challengeId;
}

/**
 * Verify an OTP against a challenge.
 * Returns the stored context if successful.
 * Throws on invalid/expired/exceeded OTP.
 */
export async function verifyOtp(
  challengeId: string,
  userId: string,
  rawOtp: string,
  purpose: OtpPurpose
): Promise<Record<string, unknown>> {
  const rows = await pgSequelize.query<{
    id: string;
    otp_hash: string;
    purpose: string;
    context: Record<string, unknown>;
    expires_at: Date;
    verified_at: Date | null;
    attempts: number;
  }>(
    `SELECT id, otp_hash, purpose, context, expires_at, verified_at, attempts
     FROM otp_challenges
     WHERE id = $1 AND user_id = $2 AND purpose = $3`,
    { bind: [challengeId, userId, purpose], type: QueryTypes.SELECT }
  );

  const challenge = rows[0];
  if (!challenge) throw new Error("INVALID_OTP_CHALLENGE");
  if (challenge.verified_at) throw new Error("OTP_ALREADY_USED");
  if (new Date() > new Date(challenge.expires_at)) throw new Error("OTP_EXPIRED");
  if (challenge.attempts >= MAX_ATTEMPTS)
    throw new Error("OTP_MAX_ATTEMPTS_EXCEEDED");

  // Increment attempt count before checking to prevent brute-force
  await pgSequelize.query(
    `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`,
    { bind: [challengeId] }
  );

  const expectedHash = hashOtp(rawOtp.trim());
  if (expectedHash !== challenge.otp_hash) {
    console.warn(`[otp] Invalid OTP attempt for challenge ${challengeId}`);
    throw new Error("INVALID_OTP");
  }

  // Mark as verified
  await pgSequelize.query(
    `UPDATE otp_challenges SET verified_at = NOW() WHERE id = $1`,
    { bind: [challengeId] }
  );

  console.log(`[otp] Challenge ${challengeId} verified successfully`);
  return challenge.context ?? {};
}
