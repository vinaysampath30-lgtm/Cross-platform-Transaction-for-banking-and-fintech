import { Router, type Request, type Response } from "express";
import { validateBody } from "../validation/schemas.js";
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from "../validation/schemas.js";
import { authLimiter } from "../middleware/rateLimiter.js";
import { requireAuthPg } from "../middleware/auth.js";
import * as auth from "../services/authServicePg.js";
import { sendPasswordResetEmail } from "../email/mailer.js";

export const authRouter = Router();
const cookieName = "nexuspay_refresh";
const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 7 * 86400000, path: "/api/auth" };

authRouter.post("/register", authLimiter, validateBody(registerSchema), async (req: Request, res: Response) => {
  try {
    const result = await auth.registerUserPg(req.body, { ipAddress: req.ip, userAgent: req.headers["user-agent"] });
    res.cookie(cookieName, result.refreshToken, cookieOptions);
    res.status(201).json({ message: "Account created successfully.", user: result.user, accessToken: result.accessToken, sessionId: result.sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "USERNAME_TAKEN" || message === "EMAIL_EXISTS") return void res.status(409).json({ error: message === "USERNAME_TAKEN" ? "That username is already taken." : "An account with that email address already exists." });
    console.error("[auth] register error:", error);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

authRouter.post("/login", authLimiter, validateBody(loginSchema), async (req: Request, res: Response) => {
  try {
    const result = await auth.loginUserPg(req.body, { ipAddress: req.ip, userAgent: req.headers["user-agent"] });
    res.cookie(cookieName, result.refreshToken, cookieOptions);
    res.json({ message: "Login successful.", user: result.user, accessToken: result.accessToken, sessionId: result.sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INVALID_CREDENTIALS") return void res.status(401).json({ error: "Incorrect username or password. Please try again." });
    console.error("[auth] login error:", error);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

authRouter.post("/refresh", async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.[cookieName];
    if (!token) return void res.status(401).json({ error: "No refresh token provided." });
    const result = await auth.rotateRefreshToken(token, { ipAddress: req.ip, userAgent: req.headers["user-agent"] });
    res.cookie(cookieName, result.refreshToken, cookieOptions);
    res.json({ accessToken: result.accessToken, sessionId: result.sessionId });
  } catch {
    res.clearCookie(cookieName, { path: "/api/auth" });
    res.status(401).json({ error: "Session expired. Please log in again." });
  }
});

authRouter.post("/logout", requireAuthPg, async (req: Request, res: Response) => {
  const token = req.cookies?.[cookieName];
  if (token) await auth.revokeSession(token);
  res.clearCookie(cookieName, { path: "/api/auth" });
  res.json({ message: "Logged out successfully." });
});

authRouter.post("/forgot-password", authLimiter, validateBody(forgotPasswordSchema), async (req: Request, res: Response) => {
  try {
    const email = String(req.body.email).trim().toLowerCase();
    const rawToken = await auth.createPasswordResetTokenPg(email);
    if (rawToken) await sendPasswordResetEmail(email, "User", `${process.env.APP_URL ?? "http://localhost:5173"}/reset-password?token=${rawToken}`);
    res.json({ message: "If an account with that email exists, a reset link has been sent." });
  } catch (error) {
    console.error("[auth] forgot-password error:", error);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

authRouter.post("/reset-password", authLimiter, validateBody(resetPasswordSchema), async (req: Request, res: Response) => {
  try {
    await auth.resetPasswordPg(req.body.token, req.body.password);
    res.json({ message: "Your password has been updated successfully." });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_OR_EXPIRED_TOKEN") return void res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    console.error("[auth] reset-password error:", error);
    res.status(500).json({ error: "An unexpected error occurred. Please try again." });
  }
});

authRouter.get("/me", requireAuthPg, (req: Request, res: Response) => res.json({ user: (req as any).user }));
