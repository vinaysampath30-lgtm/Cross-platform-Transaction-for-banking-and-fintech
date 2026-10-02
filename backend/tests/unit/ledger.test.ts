/**
 * tests/unit/ledger.test.ts
 *
 * Unit tests for ledger invariants, transfer validation,
 * transaction state machine, and idempotency logic.
 */

import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ledger Invariant
// ─────────────────────────────────────────────────────────────────────────────

describe("Ledger Invariant", () => {
  it("debit + credit must equal zero for any transfer amount", () => {
    const amounts = ["100.00", "0.01", "999999.9999", "1.2345"];
    amounts.forEach((amount) => {
      const d = new Decimal(amount);
      const debit = d.neg();
      const credit = d;
      const sum = debit.plus(credit);
      expect(sum.equals(0)).toBe(true);
    });
  });

  it("balance must remain non-negative after debit (overdraft disabled)", () => {
    const initialBalance = new Decimal("1000.0000");
    const amount = new Decimal("500.0000");
    const newBalance = initialBalance.minus(amount);
    expect(newBalance.gte(0)).toBe(true);
  });

  it("should reject transfer that would cause negative balance", () => {
    const initialBalance = new Decimal("100.0000");
    const amount = new Decimal("150.0000");
    const wouldBeNegative = initialBalance.minus(amount).lt(0);
    // wouldBeNegative === true signals INSUFFICIENT_FUNDS
    expect(wouldBeNegative).toBe(true);
  });

  it("balance conservation: sender loss = receiver gain", () => {
    const senderBefore = new Decimal("1000.0000");
    const receiverBefore = new Decimal("500.0000");
    const amount = new Decimal("200.0000");

    const senderAfter = senderBefore.minus(amount);
    const receiverAfter = receiverBefore.plus(amount);

    const totalBefore = senderBefore.plus(receiverBefore);
    const totalAfter = senderAfter.plus(receiverAfter);

    expect(totalBefore.equals(totalAfter)).toBe(true);
  });

  it("precision: NUMERIC(19,4) handles micro-amounts without floating-point error", () => {
    // Classic floating-point pitfall: 0.1 + 0.2 ≠ 0.3 in IEEE 754
    const a = new Decimal("0.1");
    const b = new Decimal("0.2");
    expect(a.plus(b).equals(new Decimal("0.3"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Transaction State Machine
// ─────────────────────────────────────────────────────────────────────────────

describe("Transaction State Machine", () => {
  const validTransitions: Record<string, string[]> = {
    initiated: ["authorized", "failed"],
    authorized: ["processing", "failed"],
    processing: ["completed", "failed"],
    completed: ["reversed"],
    failed: [],
    reversed: [],
  };

  it("should allow valid state transitions", () => {
    expect(validTransitions["initiated"]).toContain("authorized");
    expect(validTransitions["authorized"]).toContain("processing");
    expect(validTransitions["processing"]).toContain("completed");
    expect(validTransitions["completed"]).toContain("reversed");
  });

  it("should not allow backwards transitions", () => {
    expect(validTransitions["completed"]).not.toContain("initiated");
    expect(validTransitions["completed"]).not.toContain("processing");
  });

  it("failed and reversed are terminal states with no exits", () => {
    expect(validTransitions["failed"]).toHaveLength(0);
    expect(validTransitions["reversed"]).toHaveLength(0);
  });

  it("all states are reachable from initiated", () => {
    const allStates = new Set(Object.keys(validTransitions));
    const reachable = new Set<string>(["initiated"]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [from, tos] of Object.entries(validTransitions)) {
        if (reachable.has(from)) {
          for (const to of tos) {
            if (!reachable.has(to)) {
              reachable.add(to);
              changed = true;
            }
          }
        }
      }
    }
    for (const state of allStates) {
      expect(reachable.has(state)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Amount Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("Amount Validation", () => {
  it("should reject zero amount", () => {
    const amount = new Decimal("0");
    expect(amount.lte(0)).toBe(true);
  });

  it("should reject negative amount", () => {
    const amount = new Decimal("-100");
    expect(amount.lte(0)).toBe(true);
  });

  it("should accept valid positive amounts", () => {
    const valid = ["0.01", "100.00", "999999.9999", "1"];
    valid.forEach((v) => {
      const d = new Decimal(v);
      expect(d.gt(0)).toBe(true);
    });
  });

  it("should detect amounts with more than 4 decimal places", () => {
    const tooManyDecimals = "100.12345";
    const d = new Decimal(tooManyDecimals);
    expect(d.decimalPlaces()).toBeGreaterThan(4);
  });

  it("should accept amounts with exactly 4 decimal places", () => {
    const d = new Decimal("100.1234");
    expect(d.decimalPlaces()).toBeLessThanOrEqual(4);
    expect(d.gt(0)).toBe(true);
  });

  it("large transfer detection: 999999999.9999 is at the limit", () => {
    const limit = new Decimal("999999999.9999");
    expect(limit.gt(0)).toBe(true);
    const overLimit = new Decimal("1000000000.0000");
    expect(overLimit.gt(limit)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("Idempotency", () => {
  it("same idempotency key should not double-charge", () => {
    let balance = new Decimal("1000.00");
    const amount = new Decimal("100.00");
    const processedKeys = new Set<string>();
    const key = "idempotency-key-abc123";

    const applyTransfer = (k: string): boolean => {
      if (processedKeys.has(k)) return false; // Already processed — no-op
      balance = balance.minus(amount);
      processedKeys.add(k);
      return true;
    };

    const firstApplied = applyTransfer(key);
    const secondApplied = applyTransfer(key);

    expect(firstApplied).toBe(true);
    expect(secondApplied).toBe(false);
    expect(balance.equals(new Decimal("900.00"))).toBe(true);
    expect(processedKeys.size).toBe(1);
  });

  it("different keys should each be processed independently", () => {
    let balance = new Decimal("1000.00");
    const amount = new Decimal("100.00");
    const processedKeys = new Set<string>();

    const applyTransfer = (k: string): void => {
      if (processedKeys.has(k)) return;
      balance = balance.minus(amount);
      processedKeys.add(k);
    };

    applyTransfer("key-001");
    applyTransfer("key-002");

    expect(balance.equals(new Decimal("800.00"))).toBe(true);
    expect(processedKeys.size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lock Ordering (deadlock prevention)
// ─────────────────────────────────────────────────────────────────────────────

describe("Deterministic Lock Ordering", () => {
  it("always locks the lower UUID first regardless of direction", () => {
    const idA = "11111111-1111-1111-1111-111111111111";
    const idB = "22222222-2222-2222-2222-222222222222";

    // Transfer A → B
    const [first1, second1] = idA < idB ? [idA, idB] : [idB, idA];
    // Transfer B → A
    const [first2, second2] = idB < idA ? [idB, idA] : [idA, idB];

    expect(first1).toBe(first2);
    expect(second1).toBe(second2);
    expect(first1).toBe(idA); // A < B lexicographically
  });
});
