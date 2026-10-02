/**
 * tests/unit/validation.test.ts
 *
 * Unit tests for validation schemas.
 * Updated for Zod v4 (.issues instead of .errors).
 */

import { describe, it, expect } from "vitest";
import {
  createAccountSchema,
  createBeneficiarySchema,
  searchSchema,
  transactionQuerySchema,
} from "../../validation/schemas.js";

// Zod v4 helpers
function getIssues(result: { success: false; error: any }): Array<{ path: (string|number)[]; message: string }> {
  return result.error?.issues ?? result.error?.errors ?? [];
}
function hasPathIssue(result: { success: false; error: any }, fieldName: string): boolean {
  return getIssues(result).some(e => e.path.includes(fieldName));
}

describe("Account Validation", () => {
  describe("createAccountSchema", () => {
    it("should accept valid account creation data", () => {
      const result = createAccountSchema.safeParse({
        currency: "USD",
        accountNumber: "1234-5678-9012-3456",
        initialBalance: "1000.00",
      });
      expect(result.success).toBe(true);
    });

    it("should use default values for optional fields", () => {
      const result = createAccountSchema.safeParse({ currency: "EUR" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.initialBalance).toBe("0");
      }
    });

    it("should reject invalid currency code (too short)", () => {
      const result = createAccountSchema.safeParse({ currency: "US" });
      expect(result.success).toBe(false);
    });

    it("should reject lowercase currency code", () => {
      const result = createAccountSchema.safeParse({ currency: "usd" });
      expect(result.success).toBe(false);
    });

    it("should accept all supported currencies", () => {
      ["USD", "EUR", "GBP", "INR", "JPY", "AED"].forEach((currency) => {
        const result = createAccountSchema.safeParse({ currency });
        expect(result.success).toBe(true);
      });
    });
  });
});

describe("Beneficiary Validation", () => {
  describe("createBeneficiarySchema", () => {
    it("should accept valid beneficiary data", () => {
      const result = createBeneficiarySchema.safeParse({
        name: "John Doe",
        accountNumber: "1234-5678-9012-3456",
        bankName: "Chase Bank",
        bankCode: "071000013",
        currency: "USD",
        nickname: "My Friend",
        isFavorite: true,
      });
      expect(result.success).toBe(true);
    });

    it("should accept minimal required fields", () => {
      const result = createBeneficiarySchema.safeParse({
        name: "Jane Smith",
        accountNumber: "9876-5432-1098-7654",
      });
      expect(result.success).toBe(true);
    });

    it("should reject missing required fields", () => {
      const result = createBeneficiarySchema.safeParse({ bankName: "Bank" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(hasPathIssue(result, "name")).toBe(true);
        expect(hasPathIssue(result, "accountNumber")).toBe(true);
      }
    });

    it("should reject name that is too long", () => {
      const result = createBeneficiarySchema.safeParse({
        name: "A".repeat(101),
        accountNumber: "1234-5678-9012-3456",
      });
      expect(result.success).toBe(false);
    });

    it("should default isFavorite to false", () => {
      const result = createBeneficiarySchema.safeParse({
        name: "John", accountNumber: "1234-5678-9012-3456",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isFavorite).toBe(false);
      }
    });
  });
});

describe("Search Validation", () => {
  describe("searchSchema", () => {
    it("should accept valid search query", () => {
      const result = searchSchema.safeParse({
        q: "payment transfer", type: "all", limit: 20, threshold: 0.3,
      });
      expect(result.success).toBe(true);
    });

    it("should use default values", () => {
      const result = searchSchema.safeParse({ q: "test search" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("all");
        expect(result.data.limit).toBe(20);
        expect(result.data.threshold).toBe(0.3);
      }
    });

    it("should reject empty search query", () => {
      expect(searchSchema.safeParse({ q: "" }).success).toBe(false);
    });

    it("should reject search query longer than 200 characters", () => {
      expect(searchSchema.safeParse({ q: "a".repeat(201) }).success).toBe(false);
    });

    it("should reject limit > 50", () => {
      expect(searchSchema.safeParse({ q: "test", limit: 100 }).success).toBe(false);
    });

    it("should reject threshold outside 0-1 range", () => {
      expect(searchSchema.safeParse({ q: "test", threshold: 1.5 }).success).toBe(false);
      expect(searchSchema.safeParse({ q: "test", threshold: -0.5 }).success).toBe(false);
    });
  });
});

describe("Transaction Query Validation", () => {
  describe("transactionQuerySchema", () => {
    it("should accept valid query parameters", () => {
      const result = transactionQuerySchema.safeParse({
        page: 1, limit: 20, type: "internal", status: "completed",
      });
      expect(result.success).toBe(true);
    });

    it("should coerce string to number", () => {
      const result = transactionQuerySchema.safeParse({ page: "2", limit: "50" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.page).toBe("number");
        expect(typeof result.data.limit).toBe("number");
      }
    });

    it("should reject limit > 100", () => {
      expect(transactionQuerySchema.safeParse({ page: 1, limit: 200 }).success).toBe(false);
    });

    it("should reject invalid type", () => {
      expect(transactionQuerySchema.safeParse({ type: "invalid" }).success).toBe(false);
    });

    it("should reject invalid status", () => {
      // Note: 'processing' is a valid NEW status but not in the legacy schema
      // The legacy schema only allows: pending, completed, failed, reversed
      expect(transactionQuerySchema.safeParse({ status: "notavalidstatus" }).success).toBe(false);
    });

    it("should use default page and limit", () => {
      const result = transactionQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });
  });
});
