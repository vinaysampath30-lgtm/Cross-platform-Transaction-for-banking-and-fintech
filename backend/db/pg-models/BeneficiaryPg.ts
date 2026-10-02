/**
 * backend/db/pg-models/BeneficiaryPg.ts
 *
 * Sequelize model for the `beneficiaries` table in PostgreSQL.
 */

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { pgSequelize } from "../postgres.js";

export class BeneficiaryPg extends Model<
  InferAttributes<BeneficiaryPg>,
  InferCreationAttributes<BeneficiaryPg>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare name: string;
  declare account_number: string;
  declare bank_name: CreationOptional<string | null>;
  declare bank_code: CreationOptional<string | null>;
  declare currency: CreationOptional<string>;
  declare nickname: CreationOptional<string | null>;
  declare is_favorite: CreationOptional<boolean>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

BeneficiaryPg.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    user_id: { type: DataTypes.UUID, allowNull: false },
    name: { type: DataTypes.STRING(100), allowNull: false },
    account_number: { type: DataTypes.STRING(30), allowNull: false },
    bank_name: { type: DataTypes.STRING(100), allowNull: true, defaultValue: null },
    bank_code: { type: DataTypes.STRING(20), allowNull: true, defaultValue: null },
    currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: "USD" },
    nickname: { type: DataTypes.STRING(50), allowNull: true, defaultValue: null },
    is_favorite: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: pgSequelize,
    tableName: "beneficiaries",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["user_id"] },
      { unique: true, fields: ["user_id", "account_number"] },
    ],
  }
);
