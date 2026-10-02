/**
 * backend/db/pg-models/UserPg.ts
 *
 * Sequelize model for the `users` table in PostgreSQL.
 */

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { pgSequelize } from "../postgres.js";

export class UserPg extends Model<
  InferAttributes<UserPg>,
  InferCreationAttributes<UserPg>
> {
  declare id: CreationOptional<string>;
  declare username: string;
  declare first_name: string;
  declare last_name: CreationOptional<string>;
  declare email: string;
  declare password_hash: string;
  declare pin_hash: CreationOptional<string>;
  declare kyc_status: CreationOptional<string>;
  declare mfa_secret: CreationOptional<string | null>;
  declare mfa_enabled: CreationOptional<boolean>;
  declare reset_token: CreationOptional<string | null>;
  declare reset_token_expires: CreationOptional<number | null>;
  declare readonly created_at: CreationOptional<Date>;
  declare readonly updated_at: CreationOptional<Date>;
}

UserPg.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    username: { type: DataTypes.STRING(30), allowNull: false, unique: true },
    first_name: { type: DataTypes.STRING(100), allowNull: false },
    last_name: { type: DataTypes.STRING(100), allowNull: false, defaultValue: "" },
    email: { type: DataTypes.STRING(320), allowNull: false, unique: true },
    password_hash: { type: DataTypes.STRING(255), allowNull: false },
    pin_hash: { type: DataTypes.STRING(255), allowNull: false, defaultValue: "" },
    kyc_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "pending" },
    mfa_secret: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
    mfa_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    reset_token: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
    reset_token_expires: { type: DataTypes.BIGINT, allowNull: true, defaultValue: null },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: pgSequelize,
    tableName: "users",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ fields: ["email"] }, { fields: ["username"] }],
  }
);
