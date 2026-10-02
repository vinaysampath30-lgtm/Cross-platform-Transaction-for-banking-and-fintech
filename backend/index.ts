/**
 * backend/index.ts
 *
 * Main server entry point for NexusPay Banking API.
 *
 * Architecture:
 *   PostgreSQL: users, accounts, transactions, ledger_entries,
 *               sessions, beneficiaries, outbox_events, otp_challenges
 *   MySQL:      kept for migration window (legacy auth/account data)
 *   MongoDB:    notifications, activity_logs
 *
 * Authentication:
 *   - Short-lived access tokens (15 min, Bearer header)
 *   - Long-lived refresh tokens (7 days, HttpOnly cookie)
 *   - Token rotation on every refresh
 *   - Session revocation on logout
 */

import "dotenv/config";
import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import swaggerUi from "swagger-ui-express";

// Configuration
import { validateEnv } from "./config/env.js";
import { env } from "./config/env.js";
import { swaggerSpec } from "./config/swagger.js";

// Database initialization
import { initMySQL } from "./db/mysql.js";
import { initPostgres } from "./db/postgres.js";
import { initMongoDB } from "./db/mongodb.js";

// Import MySQL Sequelize models (registers them with MySQL sequelize instance)
import "./db/models/User.js";
import "./db/models/Account.js";
import "./db/models/Transaction.js";
import "./db/models/Beneficiary.js";

// Import PostgreSQL models (registers them with pg sequelize instance)
import "./db/pg-models/UserPg.js";
import "./db/pg-models/AccountPg.js";
import "./db/pg-models/TransactionPg.js";
import "./db/pg-models/LedgerEntry.js";
import "./db/pg-models/Session.js";
import "./db/pg-models/OutboxEvent.js";
import "./db/pg-models/BeneficiaryPg.js";
import "./db/pg-models/OtpChallenge.js";

// Routes (existing — keep all working)
import { authRouter } from "./routes/auth-new.js";
import { accountsRouter } from "./routes/accounts.js";
import { transactionsRouter } from "./routes/transactions.js";
import { beneficiariesRouter } from "./routes/beneficiaries.js";
import { notificationsRouter } from "./routes/notifications.js";
import { searchRouter } from "./routes/search.js";

// Middleware
import { standardLimiter, authLimiter, transferLimiter } from "./middleware/rateLimiter.js";
import { helmetMiddleware, corsMiddleware } from "./middleware/security.js";
import { requireAuth, requireAuthPg, type AuthenticatedRequest } from "./middleware/auth.js";

// New PostgreSQL services
import * as authServicePg from "./services/authServicePg.js";
import { executeTransferPg } from "./services/transferServicePg.js";
import { createOtpChallenge, verifyOtp } from "./services/otpService.js";
import { searchTransactionsFts } from "./services/searchServicePg.js";
import { startOutboxWorker, stopOutboxWorker } from "./services/outboxWorker.js";

// Validation
import {
  validateBody,
  validateQuery,
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  transferSchema,
  transactionQuerySchema,
} from "./validation/schemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REFRESH_TOKEN_COOKIE = "nexuspay_refresh";
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: "/api/auth",
};

async function startServer() {
  // Validate environment variables before any DB init
  validateEnv();

  // Initialize databases in parallel (MySQL is non-fatal for migration window)
  await Promise.all([
    initMySQL().catch((err) => {
      console.warn("[server] MySQL unavailable (non-fatal during PG migration):", err?.message);
    }),
    initPostgres(),
    initMongoDB(),
  ]);

  // Start background outbox worker
  startOutboxWorker();

  const app = express();
  const server = createServer(app);

  // ── Security middleware (BEFORE routes) ──────────────────────────────────
  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(cookieParser(env.cookieSecret));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.set("trust proxy", 1); // Trust first proxy (for rate limiting behind reverse proxy)

  // Apply standard rate limiting to all API routes
  app.use("/api", standardLimiter);

  // ── API documentation (Swagger) ───────────────────────────────────────────
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: ".swagger-ui .topbar { display: none }",
      customSiteTitle: "NexusPay API Docs",
    })
  );
  app.get("/api/docs.json", (_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });

  // ── Health check ──────────────────────────────────────────────────────────
  app.get("/api/health", async (_req: Request, res: Response) => {
    try {
      const { pgSequelize } = await import("./db/postgres.js");
      const mongoose = await import("mongoose");
      const [pgOk, mongoOk] = await Promise.all([
        pgSequelize.query("SELECT 1").then(() => true).catch(() => false),
        mongoose.default.connection.readyState === 1 ? Promise.resolve(true) : Promise.resolve(false),
      ]);
      const status = pgOk && mongoOk ? "ok" : "degraded";
      res.status(pgOk && mongoOk ? 200 : 503).json({
        status,
        postgres: pgOk ? "up" : "down",
        mongo: mongoOk ? "up" : "down",
        timestamp: new Date().toISOString(),
        version: "2.0.0",
      });
    } catch {
      res.status(503).json({ status: "error", timestamp: new Date().toISOString() });
    }
  });

  // ── Existing API routes (backward compatible) ─────────────────────────────
  app.use("/api/auth", authRouter);
  app.use("/api/accounts", accountsRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/beneficiaries", beneficiariesRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/search", searchRouter);

  // ── New PostgreSQL-backed auth endpoints ──────────────────────────────────

  /** POST /api/auth/v2/register — PostgreSQL registration with refresh token cookie */
  app.post(
    "/api/auth/v2/register",
    authLimiter,
    validateBody(registerSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const ip = req.ip ?? req.socket.remoteAddress;
        const ua = req.headers["user-agent"];
        const result = await authServicePg.registerUserPg(req.body, { ipAddress: ip, userAgent: ua });
        res.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, COOKIE_OPTIONS);
        res.status(201).json({
          message: "Account created successfully",
          user: result.user,
          accessToken: result.accessToken,
          sessionId: result.sessionId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg === "USERNAME_TAKEN") { res.status(409).json({ error: "That username is already taken." }); return; }
        if (msg === "EMAIL_EXISTS") { res.status(409).json({ error: "An account with that email already exists." }); return; }
        console.error("[auth/v2] Register error:", err instanceof Error ? err.message : err);
        res.status(500).json({ error: "Registration failed. Please try again." });
      }
    }
  );

  /** POST /api/auth/v2/login — PostgreSQL login with refresh token cookie */
  app.post(
    "/api/auth/v2/login",
    authLimiter,
    validateBody(loginSchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const ip = req.ip ?? req.socket.remoteAddress;
        const ua = req.headers["user-agent"];
        const result = await authServicePg.loginUserPg(req.body, { ipAddress: ip, userAgent: ua });
        res.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, COOKIE_OPTIONS);
        res.status(200).json({
          message: "Login successful",
          user: result.user,
          accessToken: result.accessToken,
          sessionId: result.sessionId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg === "INVALID_CREDENTIALS") { res.status(401).json({ error: "Incorrect username or password." }); return; }
        console.error("[auth/v2] Login error:", err instanceof Error ? err.message : err);
        res.status(500).json({ error: "Login failed. Please try again." });
      }
    }
  );

  /** POST /api/auth/refresh — rotate refresh token */
  app.post("/api/auth/refresh", async (req: Request, res: Response): Promise<void> => {
    try {
      const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
      if (!rawToken) { res.status(401).json({ error: "No refresh token provided." }); return; }
      const ip = req.ip ?? req.socket.remoteAddress;
      const ua = req.headers["user-agent"];
      const result = await authServicePg.rotateRefreshToken(rawToken, { ipAddress: ip, userAgent: ua });
      res.cookie(REFRESH_TOKEN_COOKIE, result.refreshToken, COOKIE_OPTIONS);
      res.json({ accessToken: result.accessToken, sessionId: result.sessionId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      res.clearCookie(REFRESH_TOKEN_COOKIE, { path: "/api/auth" });
      if (msg === "INVALID_REFRESH_TOKEN") { res.status(401).json({ error: "Session expired. Please log in again." }); return; }
      console.error("[auth] Refresh error:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Token refresh failed." });
    }
  });

  /** POST /api/auth/logout — revoke session */
  app.post("/api/auth/logout", requireAuthPg, async (req: Request, res: Response): Promise<void> => {
    try {
      const rawToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
      if (rawToken) await authServicePg.revokeSession(rawToken);
      res.clearCookie(REFRESH_TOKEN_COOKIE, { path: "/api/auth" });
      res.json({ message: "Logged out successfully." });
    } catch (err) {
      console.error("[auth] Logout error:", err instanceof Error ? err.message : err);
      res.clearCookie(REFRESH_TOKEN_COOKIE, { path: "/api/auth" });
      res.json({ message: "Logged out." });
    }
  });

  // ── New PostgreSQL-backed transfer endpoint (v2) ───────────────────────────

  /** POST /api/transactions/v2/transfer — PostgreSQL transfer with ledger + idempotency */
  app.post(
    "/api/transactions/v2/transfer",
    transferLimiter,
    requireAuthPg,
    validateBody(transferSchema),
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const userId = req.user!.id;
        const { receiverAccountNumber, amount, currency, reference, beneficiaryId, note } = req.body;
        const idempotencyKey = (req.headers["idempotency-key"] as string) || undefined;
        const ip = req.ip ?? req.socket.remoteAddress;
        const ua = req.headers["user-agent"];

        // Find sender account
        const { AccountPg } = await import("./db/pg-models/AccountPg.js");
        const senderAccount = await AccountPg.findOne({ where: { user_id: userId, currency } });
        if (!senderAccount) {
          res.status(400).json({ error: `You don't have a ${currency} account.` });
          return;
        }

        // Check MFA threshold
        const amountNum = parseFloat(amount);
        const mfaRequired = env.mfaEnabled && amountNum >= env.transferMfaThreshold;

        if (mfaRequired) {
          const challengeIdHeader = req.headers["x-otp-challenge-id"] as string;
          const otpCode = req.headers["x-otp-code"] as string;

          if (!challengeIdHeader || !otpCode) {
            // Create challenge and require OTP
            const { UserPg } = await import("./db/pg-models/UserPg.js");
            const user = await UserPg.findByPk(userId, { attributes: ["email"] });
            if (!user) { res.status(400).json({ error: "User not found." }); return; }

            const challengeId = await createOtpChallenge(userId, user.email, "transfer", {
              amount, currency, receiverAccountNumber, referenceId: reference,
            });

            res.status(202).json({
              message: "OTP required for this transfer amount.",
              challengeId,
              mfaRequired: true,
            });
            return;
          }

          // Verify OTP
          try {
            await verifyOtp(challengeIdHeader, userId, otpCode, "transfer");
          } catch (otpErr) {
            const otpMsg = otpErr instanceof Error ? otpErr.message : "";
            if (["INVALID_OTP", "OTP_EXPIRED", "OTP_MAX_ATTEMPTS_EXCEEDED", "OTP_ALREADY_USED", "INVALID_OTP_CHALLENGE"].includes(otpMsg)) {
              res.status(400).json({ error: "Invalid or expired OTP. Please request a new code.", code: otpMsg });
              return;
            }
            throw otpErr;
          }
        }

        const result = await executeTransferPg(
          userId,
          {
            senderAccountId: senderAccount.id,
            receiverAccountNumber,
            amount,
            currency,
            transactionType: "internal",
            referenceId: reference,
            idempotencyKey,
            note,
          },
          { ipAddress: ip, userAgent: ua }
        );

        const statusCode = result.idempotent ? 200 : 201;
        res.status(statusCode).json({
          message: result.idempotent ? "Transfer already processed (idempotent)" : "Transfer completed successfully",
          transaction: result,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg === "INSUFFICIENT_FUNDS") { res.status(422).json({ error: "Insufficient balance for this transfer.", code: "INSUFFICIENT_FUNDS" }); return; }
        if (msg === "SELF_TRANSFER") { res.status(400).json({ error: "Cannot transfer to your own account.", code: "SELF_TRANSFER" }); return; }
        if (msg.includes("RECEIVER_NOT_FOUND") || msg.includes("NOT_FOUND")) { res.status(404).json({ error: "Recipient account not found." }); return; }
        if (msg === "CURRENCY_MISMATCH") { res.status(400).json({ error: "Recipient account currency does not match.", code: "CURRENCY_MISMATCH" }); return; }
        console.error("[transactions/v2] Transfer error:", msg);
        res.status(500).json({ error: "Transfer failed. Please try again.", code: "TRANSFER_FAILED" });
      }
    }
  );

  /** GET /api/transactions/search-fts — PostgreSQL full-text search */
  app.get(
    "/api/transactions/search-fts",
    requireAuthPg,
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      try {
        const userId = req.user!.id;
        const q = req.query.q as string;
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
        if (!q || q.trim().length === 0) {
          res.status(400).json({ error: "Query parameter 'q' is required." });
          return;
        }
        const results = await searchTransactionsFts(userId, q.trim(), { limit });
        res.json({ results, count: results.length, searchEngine: "postgresql-fts" });
      } catch (err) {
        console.error("[search-fts] Error:", err instanceof Error ? err.message : err);
        res.status(500).json({ error: "Search failed." });
      }
    }
  );

  // ── 404 handler for API routes ────────────────────────────────────────────
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
  });

  // ── Static + SPA (production only) ───────────────────────────────────────
  if (process.env.NODE_ENV === "production") {
    const staticPath = path.resolve(__dirname, "public");
    app.use(express.static(staticPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(staticPath, "index.html"));
    });
  }

  // ── Global error handler ──────────────────────────────────────────────────
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[server] Unhandled error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  // ── Start server ──────────────────────────────────────────────────────────
  const port =
    process.env.NODE_ENV === "production"
      ? Number(process.env.PORT ?? 3000)
      : 3001;

  server.listen(port, () => {
    console.log(`[server] NexusPay v2.0 running on http://localhost:${port}/`);
    console.log(`[server] API docs: http://localhost:${port}/api/docs`);
    console.log(`[server] PostgreSQL: enabled`);
    console.log(`[server] Outbox worker: started`);
  });

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`[server] ${signal} received — shutting down gracefully`);
    stopOutboxWorker();
    server.close(() => {
      console.log("[server] HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000); // Force exit after 10s
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});
