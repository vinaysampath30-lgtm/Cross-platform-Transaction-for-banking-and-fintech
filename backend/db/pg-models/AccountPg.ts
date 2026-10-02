/**
 * backend/db/pg-models/AccountPg.ts
 *
 * Sequelize model for the `accounts` table in PostgreSQL.
 * Balance is stored as string to preserve NUMERIC(19,4) precision.
 */

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { pgSequelize } from "../postgres.js";

export class AccountPg extends Model<
  InferAttributes<AccountPg>,
  InferCreationAttributes<AccountPg>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare account_number: string;
  declare balance: string; // NUMERIC stored as string for precision
  declare currency: string;
  declare version_id: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

AccountPg.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "users", key: "id" },
    },
    account_number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    balance: { type: DataTypes.DECIMAL(19, 4), allowNull: false, defaultValue: "0.0000" },
    currency: { type: DataTypes.CHAR(3), allowNull: false },
    version_id: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: pgSequelize,
    tableName: "accounts",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["user_id"] },
      { unique: true, fields: ["user_id", "currency"] },
    ],
  }
);
