/**
 * backend/config/env.ts
 *
 * Startup environment validation module.
 * Call validateEnv() once at the very start of backend/index.ts before any
 * DB initialisation.  The module also exports a pre-validated `env` object
 * so the rest of the codebase can import typed env values instead of reading
 * process.env directly.
 *
 * Security contract
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * This module MUST NOT log the VALUE of any variable whose name contains the
 * substrings PASSWORD, SECRET, KEY, or TOKEN (case-insensitive).
 * Only the variable NAME is ever written to the log.
 */

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Returns true if the variable name is considered sensitive. */
function isSensitiveName(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    upper.includes("PASSWORD") ||
    upper.includes("SECRET") ||
    upper.includes("KEY") ||
    upper.includes("TOKEN")
  );
}

/**
 * Reads an env var and records it as missing when absent.
 * Never logs the value; only the name is used in error messages.
 */
function required(
  name: string,
  missing: string[]
): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    missing.push(name);
    return undefined;
  }
  return value;
}

// â”€â”€ validateEnv â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Validates all required and conditional environment variables.
 * Logs missing variable NAMES (never values) with prefix [config] and calls
 * process.exit(1) if validation fails.
 *
 * Call this function before any database initialisation.
 */
export function validateEnv(): void {
  const missing: string[] = [];

  // â”€â”€ Required variables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // PostgreSQL is authoritative for banking data.
  const pgHost = required("PG_HOST", missing);
  const pgPortRaw = required("PG_PORT", missing);
  const pgUser = required("PG_USER", missing);
  const pgPassword = required("PG_PASSWORD", missing);
  const pgName = required("PG_NAME", missing);
  const mongoUri      = required("DB_MONGO_URI",      missing);
  const jwtSecret     = required("JWT_SECRET",        missing);

  // Report missing required vars before doing any further validation
  if (missing.length > 0) {
    for (const name of missing) {
      console.error(`[config] Missing required environment variable: ${name}`);
    }
    process.exit(1);
  }

  // â”€â”€ JWT_SECRET length â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // At this point jwtSecret is guaranteed to be defined (missing check above).
  if ((jwtSecret as string).length < 32) {
    console.error(
      `[config] JWT_SECRET must be at least 32 characters long (got ${(jwtSecret as string).length})`
    );
    process.exit(1);
  }

  // â”€â”€ Conditional: MySQL SSL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // â”€â”€ Conditional: MongoDB TLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const mongoTlsRaw = process.env["DB_MONGO_TLS"];
  if (mongoTlsRaw === "true") {
    const tlsCa = process.env["DB_MONGO_TLS_CA"];
    if (!tlsCa || tlsCa.trim() === "") {
      console.error(
        "[config] DB_MONGO_TLS_CA is required when DB_MONGO_TLS=true"
      );
      process.exit(1);
    }
  }

  // â”€â”€ Optional: DB_MYSQL_POOL_MAX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // â”€â”€ Optional: AUDIT_LOG_RETENTION_DAYS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const retentionRaw = process.env["AUDIT_LOG_RETENTION_DAYS"];
  if (retentionRaw !== undefined && retentionRaw.trim() !== "") {
    const days = Number(retentionRaw);
    if (!Number.isInteger(days) || days < 1) {
      console.warn(
        "[config] AUDIT_LOG_RETENTION_DAYS must be a positive integer; TTL index will not be created"
      );
    }
  }

  // All validations passed â€” no log needed (keep startup output clean)
  void pgHost;
  void pgPortRaw;
  void pgUser;
  void pgPassword;
  void pgName;
  void mongoUri;
}

// â”€â”€ env â€” typed accessor object â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Pre-parsed, typed environment values.
 *
 * âš  This object is populated lazily at module load time, AFTER validateEnv()
 *   has been called from backend/index.ts.  If you import `env` before calling
 *   validateEnv() some fields may be empty strings, which is intentional â€”
 *   the startup guard will have already exited the process if required vars
 *   were missing.
 */
export const env = {
  // â”€â”€ Node â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get nodeEnv(): string {
    return process.env["NODE_ENV"] ?? "development";
  },

  // â”€â”€ MySQL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // â”€â”€ MongoDB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get mongoUri(): string {
    return process.env["DB_MONGO_URI"] ?? "";
  },
  get mongoTls(): boolean {
    return process.env["DB_MONGO_TLS"] === "true";
  },
  get mongoTlsCa(): string | undefined {
    return process.env["DB_MONGO_TLS_CA"] ?? undefined;
  },

  // â”€â”€ Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get jwtSecret(): string {
    return process.env["JWT_SECRET"] ?? "";
  },

  // â”€â”€ Audit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get auditLogRetentionDays(): number | undefined {
    const raw = process.env["AUDIT_LOG_RETENTION_DAYS"];
    if (raw === undefined || raw.trim() === "") return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
  },

  // â”€â”€ PostgreSQL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get pgHost(): string {
    return process.env["PG_HOST"] ?? "localhost";
  },
  get pgPort(): number {
    const r = process.env["PG_PORT"];
    const n = Number(r);
    return Number.isFinite(n) && n > 0 ? n : 5432;
  },
  get pgUser(): string {
    return process.env["PG_USER"] ?? "";
  },
  get pgPassword(): string {
    return process.env["PG_PASSWORD"] ?? "";
  },
  get pgName(): string {
    return process.env["PG_NAME"] ?? "nexuspay";
  },
  get pgPoolMax(): number {
    const r = process.env["PG_POOL_MAX"];
    if (!r) return 10;
    const n = Number(r);
    return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 10;
  },
  get pgSsl(): boolean {
    return process.env["PG_SSL"] === "true";
  },
  get pgSslCa(): string | undefined {
    return process.env["PG_SSL_CA"] ?? undefined;
  },

  // â”€â”€ Tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get accessTokenSecret(): string {
    return process.env["ACCESS_TOKEN_SECRET"] ?? process.env["JWT_SECRET"] ?? "";
  },
  get refreshTokenSecret(): string {
    return process.env["REFRESH_TOKEN_SECRET"] ?? process.env["JWT_SECRET"] ?? "";
  },
  get accessTokenExpiry(): string {
    return process.env["ACCESS_TOKEN_EXPIRY"] ?? "15m";
  },
  get refreshTokenExpiry(): string {
    return process.env["REFRESH_TOKEN_EXPIRY"] ?? "7d";
  },

  // â”€â”€ MFA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get transferMfaThreshold(): number {
    const r = process.env["TRANSFER_MFA_THRESHOLD"];
    const n = Number(r);
    return Number.isFinite(n) ? n : 1000;
  },
  get mfaEnabled(): boolean {
    return process.env["MFA_ENABLED"] !== "false";
  },

  // â”€â”€ Cookie â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  get cookieSecret(): string {
    return process.env["COOKIE_SECRET"] ?? process.env["JWT_SECRET"] ?? "";
  },
  get isProduction(): boolean {
    return process.env["NODE_ENV"] === "production";
  },
} as const satisfies {
  nodeEnv: string;
  mongoUri: string;
  mongoTls: boolean;
  mongoTlsCa?: string;
  jwtSecret: string;
  auditLogRetentionDays?: number;
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
  pgName: string;
  pgPoolMax: number;
  pgSsl: boolean;
  pgSslCa?: string;
  accessTokenSecret: string;
  refreshTokenSecret: string;
  accessTokenExpiry: string;
  refreshTokenExpiry: string;
  transferMfaThreshold: number;
  mfaEnabled: boolean;
  cookieSecret: string;
  isProduction: boolean;
};
