/**
 * tests/unit/auth.test.ts
 *
 * Unit tests for authentication logic.
 * Tests password hashing, JWT generation, and validation.
 * Updated for Zod v4 (uses .issues instead of .errors).
 */

import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  registerSchema,
  loginSchema,
} from "../../validation/schemas.js";

// Zod v4 helper: get the first issue message from a failed parse
function firstIssue(result: { success: false; error: any }): string {
  return result.error?.issues?.[0]?.message ?? result.error?.errors?.[0]?.message ?? "";
}

describe("Auth Validation Schemas", () => {
  describe("registerSchema", () => {
    it("should accept valid registration data", () => {
      const result = registerSchema.safeParse({
        firstName: "John", lastName: "Doe",
        email: "john.doe@example.com", username: "johndoe", password: "Password1!",
      });
      expect(result.success).toBe(true);
    });

    it("should reject username shorter than 4 characters", () => {
      const result = registerSchema.safeParse({
        firstName: "John", lastName: "Doe",
        email: "john.doe@example.com", username: "jo", password: "Password1!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(firstIssue(result)).toContain("at least 4");
      }
    });

    it("should reject invalid email format", () => {
      const result = registerSchema.safeParse({
        firstName: "John", lastName: "Doe",
        email: "not-an-email", username: "johndoe", password: "Password1!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(firstIssue(result).toLowerCase()).toMatch(/email|invalid/);
      }
    });

    it("should reject password without uppercase letter", () => {
      const result = registerSchema.safeParse({
        firstName: "John", lastName: "Doe",
        email: "john.doe@example.com", username: "johndoe", password: "password1!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(firstIssue(result).toLowerCase()).toMatch(/uppercase/);
      }
    });

    it("should reject password without number", () => {
      const result = registerSchema.safeParse({
        firstName: "John", lastName: "Doe",
        email: "john.doe@example.com", username: "johndoe", password: "Password!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(firstIssue(result).toLowerCase()).toMatch(/number/);
      }
    });

    it("should reject password without special character", () => {
      const result = registerSchema.safeParse({
        firstName: "John", lastName: "Doe",
        email: "john.doe@example.com", username: "johndoe", password: "Password1",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(firstIssue(result).toLowerCase()).toMatch(/special/);
      }
    });

    it("should reject password shorter than 8 characters", () => {
      const result = registerSchema.safeParse({
        firstName: "John", lastName: "Doe",
        email: "john.doe@example.com", username: "johndoe", password: "Pass1!",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(firstIssue(result).toLowerCase()).toMatch(/8|at least/);
      }
    });

    it("should accept password that meets all requirements", () => {
      ["Password1!", "MySecure123$", "Test@Pass99", "Abcdefg1!"].forEach((password) => {
        const result = registerSchema.safeParse({
          firstName: "John", lastName: "Doe",
          email: "john.doe@example.com", username: "johndoe", password,
        });
        expect(result.success).toBe(true);
      });
    });
  });

  describe("loginSchema", () => {
    it("should accept valid login data", () => {
      const result = loginSchema.safeParse({ username: "johndoe", password: "Password1!" });
      expect(result.success).toBe(true);
    });

    it("should reject missing username", () => {
      const result = loginSchema.safeParse({ password: "Password1!" });
      expect(result.success).toBe(false);
    });

    it("should reject missing password", () => {
      const result = loginSchema.safeParse({ username: "johndoe" });
      expect(result.success).toBe(false);
    });
  });
});

describe("Password Hashing", () => {
  it("should hash password correctly", async () => {
    const hash = await bcrypt.hash("Password1!", 12);
    expect(hash).not.toBe("Password1!");
    expect(hash.length).toBeGreaterThan(50);
  });

  it("should verify correct password", async () => {
    const hash = await bcrypt.hash("Password1!", 12);
    expect(await bcrypt.compare("Password1!", hash)).toBe(true);
  });

  it("should reject incorrect password", async () => {
    const hash = await bcrypt.hash("Password1!", 12);
    expect(await bcrypt.compare("WrongPassword1!", hash)).toBe(false);
  });

  it("should generate different hashes for same password", async () => {
    const hash1 = await bcrypt.hash("Password1!", 12);
    const hash2 = await bcrypt.hash("Password1!", 12);
    expect(hash1).not.toBe(hash2);
  });
});

describe("JWT Token Generation", () => {
  const secret = "test_jwt_secret_at_least_32_characters_long";

  it("should generate valid JWT token", () => {
    const payload = { id: "550e8400-e29b-41d4-a716-446655440000", username: "johndoe", email: "john.doe@example.com" };
    const token = jwt.sign(payload, secret, { expiresIn: "7d" });
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
  });

  it("should verify valid JWT token", () => {
    const payload = { id: "550e8400-e29b-41d4-a716-446655440000", username: "johndoe", email: "john.doe@example.com" };
    const token = jwt.sign(payload, secret, { expiresIn: "7d" });
    const decoded = jwt.verify(token, secret) as typeof payload;
    expect(decoded.id).toBe(payload.id);
    expect(decoded.username).toBe(payload.username);
    expect(decoded.email).toBe(payload.email);
  });

  it("should reject invalid JWT token", () => {
    expect(() => jwt.verify("invalid.token.here", secret)).toThrow();
  });

  it("should reject expired JWT token", () => {
    const payload = { id: "550e8400-e29b-41d4-a716-446655440000", username: "johndoe", email: "john.doe@example.com" };
    const token = jwt.sign(payload, secret, { expiresIn: "-1h" });
    expect(() => jwt.verify(token, secret)).toThrow(jwt.TokenExpiredError);
  });

  it("should generate short-lived access token (15m) via issueAccessToken pattern", () => {
    const payload = { sub: "usr-001", username: "johndoe", email: "j@j.com", tokenType: "access", jti: "abc123" };
    const token = jwt.sign(payload, secret, { expiresIn: "15m", issuer: "nexuspay", audience: "nexuspay-client" });
    const decoded = jwt.verify(token, secret, { issuer: "nexuspay", audience: "nexuspay-client" }) as any;
    expect(decoded.tokenType).toBe("access");
    expect(decoded.sub).toBe("usr-001");
    // Token should expire in about 15 minutes
    const remaining = decoded.exp - Math.floor(Date.now() / 1000);
    expect(remaining).toBeLessThanOrEqual(900);
    expect(remaining).toBeGreaterThan(800);
  });
});
