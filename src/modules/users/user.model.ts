import mongoose, { Schema, Document } from 'mongoose';
import type { IUser } from './user.types.js';

export interface IUserDocument extends Omit<IUser, '_id'>, Document {}

const UserSchema = new Schema<IUserDocument>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-z0-9_.]+$/,
    },
    nickname: { type: String, required: true, trim: true, minlength: 1, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    roles: { type: [String], default: ['customer'] },
    avatar: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    isSuspicious: { type: Boolean, default: false },
    badReportCounter: { type: Number, default: 0 },
    bankAccountForRefund: {
      type: { number: String, bank: String, holder: String },
      default: null,
    },
    notificationPrefs: {
      orderUpdates: { type: Boolean, default: true },
      promotions: { type: Boolean, default: false },
      social: { type: Boolean, default: true },
    },
    fcmTokens: { type: [String], default: [] },
    tosAcceptedAt: { type: Date, default: null },
    tosVersion: { type: String, default: null },
  },
  { timestamps: true }
);

// username, email, phone index duoc tao tu dong qua unique:true trong schema

export const UserModel = mongoose.model<IUserDocument>('User', UserSchema);
