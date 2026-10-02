/**
 * backend/db/pg-models/LedgerEntry.ts
 *
 * Sequelize model for the `ledger_entries` table in PostgreSQL.
 * Ledger entries are fully immutable â€” no updates or deletes allowed.
 */

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { pgSequelize } from "../postgres.js";

export class LedgerEntry extends Model<
  InferAttributes<LedgerEntry>,
  InferCreationAttributes<LedgerEntry>
> {
  declare id: CreationOptional<string>;
  declare transaction_id: string;
  declare account_id: string;
  declare entry_type: "debit" | "credit";
  declare amount: string; // Negative for debit, positive for credit
  declare balance_after: string;
  declare currency: string;
  declare readonly created_at: CreationOptional<Date>;
}

LedgerEntry.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    transaction_id: { type: DataTypes.UUID, allowNull: false },
    account_id: { type: DataTypes.UUID, allowNull: false },
    entry_type: { type: DataTypes.STRING(10), allowNull: false },
    amount: { type: DataTypes.DECIMAL(19, 4), allowNull: false },
    balance_after: { type: DataTypes.DECIMAL(19, 4), allowNull: false },
    currency: { type: DataTypes.CHAR(3), allowNull: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: pgSequelize,
    tableName: "ledger_entries",
    timestamps: false,
    indexes: [
      { fields: ["account_id", "created_at"] },
      { fields: ["transaction_id"] },
    ],
  }
);

// Enforce full immutability of ledger entries
LedgerEntry.addHook("beforeUpdate", () => {
  throw new Error("Ledger entries are immutable");
});
LedgerEntry.addHook("beforeBulkUpdate", () => {
  throw new Error("Ledger entries are immutable");
});
LedgerEntry.addHook("beforeDestroy", () => {
  throw new Error("Ledger entries cannot be deleted");
});
LedgerEntry.addHook("beforeBulkDestroy", () => {
  throw new Error("Ledger entries cannot be deleted");
});
