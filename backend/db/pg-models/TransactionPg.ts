/**
 * backend/db/pg-models/TransactionPg.ts
 *
 * Sequelize model for the `transactions` table in PostgreSQL.
 * Transactions are immutable once created â€” bulk updates/deletes are blocked.
 */

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { pgSequelize } from "../postgres.js";

export type TxStatus =
  | "initiated"
  | "authorized"
  | "processing"
  | "completed"
  | "failed"
  | "reversed";

export type TxType = "internal" | "wire" | "billpay";

export class TransactionPg extends Model<
  InferAttributes<TransactionPg>,
  InferCreationAttributes<TransactionPg>
> {
  declare id: CreationOptional<string>;
  declare sender_account_id: string;
  declare receiver_account_id: string;
  declare amount: string;
  declare currency: string;
  declare transaction_type: TxType;
  declare status: CreationOptional<TxStatus>;
  declare reference_id: CreationOptional<string | null>;
  declare idempotency_key: CreationOptional<string | null>;
  declare readonly created_at: CreationOptional<Date>;
}

TransactionPg.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    sender_account_id: { type: DataTypes.UUID, allowNull: false },
    receiver_account_id: { type: DataTypes.UUID, allowNull: false },
    amount: { type: DataTypes.DECIMAL(19, 4), allowNull: false },
    currency: { type: DataTypes.CHAR(3), allowNull: false },
    transaction_type: { type: DataTypes.STRING(20), allowNull: false },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "initiated" },
    reference_id: { type: DataTypes.STRING(128), allowNull: true, defaultValue: null },
    idempotency_key: { type: DataTypes.STRING(128), allowNull: true, defaultValue: null },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: pgSequelize,
    tableName: "transactions",
    timestamps: false,
    indexes: [
      { fields: ["sender_account_id", "created_at"] },
      { fields: ["receiver_account_id", "created_at"] },
      { unique: true, fields: ["sender_account_id", "idempotency_key"] },
    ],
  }
);

// Guard against accidental bulk mutations
TransactionPg.addHook("beforeBulkUpdate", () => {
  throw new Error("Use service methods for transaction updates");
});
TransactionPg.addHook("beforeBulkDestroy", () => {
  throw new Error("Transactions cannot be deleted");
});
