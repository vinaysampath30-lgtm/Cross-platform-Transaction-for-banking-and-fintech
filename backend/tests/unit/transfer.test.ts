/**
 * tests/unit/transfer.test.ts
 *
 * Unit tests for transfer validation logic.
 * Updated for Zod v4 (.issues instead of .errors).
 */

import { describe, it, expect } from "vitest";
import { transferSchema } from "../../validation/schemas.js";

// Zod v4 helper
function firstIssue(result: { success: false; error: any }): string {
  return result.error?.issues?.[0]?.message ?? result.error?.errors?.[0]?.message ?? "";
}

describe("Transfer Validation", () => {
  describe("transferSchema", () => {
    it("should accept valid transfer data", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456",
        amount: "100.50",
        currency: "USD",
        reference: "Invoice #123",
        note: "Payment for services",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid receiver account number (too short)", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234567",
        amount: "100.00",
        currency: "USD",
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid amount format", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456",
        amount: "not-a-number",
        currency: "USD",
      });
      expect(result.success).toBe(false);
    });

    it("should reject zero amount", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456",
        amount: "0",
        currency: "USD",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(firstIssue(result).toLowerCase()).toMatch(/greater than 0|must be greater|positive/);
      }
    });

    it("should reject negative amount", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456",
        amount: "-50.00",
        currency: "USD",
      });
      expect(result.success).toBe(false);
    });

    it("should accept amounts with up to 4 decimal places", () => {
      ["100.1234", "50.12", "25.1", "10"].forEach((amount) => {
        const result = transferSchema.safeParse({
          receiverAccountNumber: "1234-5678-9012-3456",
          amount,
          currency: "USD",
        });
        expect(result.success).toBe(true);
      });
    });

    it("should reject invalid currency code (too short)", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456",
        amount: "100.00",
        currency: "US",
      });
      expect(result.success).toBe(false);
    });

    it("should reject lowercase currency code", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456",
        amount: "100.00",
        currency: "usd",
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid currency codes", () => {
      ["USD", "EUR", "GBP", "JPY", "INR"].forEach((currency) => {
        const result = transferSchema.safeParse({
          receiverAccountNumber: "1234-5678-9012-3456",
          amount: "100.00",
          currency,
        });
        expect(result.success).toBe(true);
      });
    });

    it("should accept optional fields including idempotencyKey", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456",
        amount: "100.00",
        currency: "USD",
        reference: "Ref-123",
        beneficiaryId: "550e8400-e29b-41d4-a716-446655440000",
        note: "Test note",
        idempotencyKey: "client-uuid-abc-123",
      });
      expect(result.success).toBe(true);
    });

    it("should require receiverAccountNumber", () => {
      const result = transferSchema.safeParse({ amount: "100.00", currency: "USD" });
      expect(result.success).toBe(false);
    });

    it("should require amount", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456", currency: "USD",
      });
      expect(result.success).toBe(false);
    });

    it("should require currency", () => {
      const result = transferSchema.safeParse({
        receiverAccountNumber: "1234-5678-9012-3456", amount: "100.00",
      });
      expect(result.success).toBe(false);
    });
  });
});
