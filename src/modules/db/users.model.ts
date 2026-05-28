import mongoose, { Schema, Document, Model } from 'mongoose'

export type UserRole = 'customer' | 'store_owner' | 'mod' | 'admin' | 'shipper'
export type VipTier = 'none' | 'vip' | 'vvip' | 'vvvip'

export interface AuthPayload {
  userId: string
  roles: UserRole[]
}

export interface IUser extends Document {
  username: string
  nickname: string
  email: string
  phone: string
  passwordHash: string
  roles: UserRole[]
  avatar: string | null
  isActive: boolean
  isSuspicious: boolean
  badReportCounter: number
  defaultPaymentMethod: 'bankTransfer' | 'cod' | 'fiftyFifty' | 'momo' | 'zaloPay' | null
  bankAccountForRefund: {
    number: string
    bank: string
    holder: string
  } | null
  followers: mongoose.Types.ObjectId[]    // Phase 2
  following: mongoose.Types.ObjectId[]    // Phase 2
  blockedUsers: mongoose.Types.ObjectId[]
  notificationPrefs: {
    orderUpdates: boolean
    promotions: boolean
    social: boolean
  }
  privacy: {
    showPhone: boolean
    showAddress: boolean
    showFavorites: boolean
  }
  fcmTokens: string[]
  exp: number
  vipTier: VipTier
  tosAcceptedAt: Date | null
  tosVersion: string | null
  tosAcceptedIp: string | null
  createdAt: Date
  updatedAt: Date
}

const UserSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, 'Username là bắt buộc'],
      unique: true,
      lowercase: true,
      trim: true,
      minlength: [3, 'Username tối thiểu 3 ký tự'],
      maxlength: [30, 'Username tối đa 30 ký tự'],
      match: [/^[a-z0-9_.]+$/, 'Username chỉ chứa a-z, 0-9, dấu chấm và gạch dưới'],
    },
    nickname: {
      type: String,
      required: [true, 'Nickname là bắt buộc'],
      trim: true,
      minlength: [1, 'Nickname tối thiểu 1 ký tự'],
      maxlength: [50, 'Nickname tối đa 50 ký tự'],
    },
    email: {
      type: String,
      required: [true, 'Email là bắt buộc'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Email không hợp lệ'],
    },
    phone: {
      type: String,
      required: [true, 'Số điện thoại là bắt buộc'],
      unique: true,
      trim: true,
      match: [/^0[0-9]{9}$/, 'Số điện thoại phải có dạng 0xxxxxxxxx (10 số)'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash là bắt buộc'],
    },
    roles: {
      type: [String],
      enum: ['customer', 'store_owner', 'mod', 'admin', 'shipper'],
      default: ['customer'],
    },
    avatar: {
      type: String,
      default: null,
    },
    defaultPaymentMethod: {
      type: String,
      enum: ['bankTransfer', 'cod', 'fiftyFifty', 'momo', 'zaloPay', null],
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isSuspicious: {
      type: Boolean,
      default: false,
    },
    badReportCounter: {
      type: Number,
      default: 0,
      min: 0,
    },
    bankAccountForRefund: {
      type: new Schema(
        {
          number: { type: String, required: true, trim: true },
          bank: { type: String, required: true, trim: true },
          holder: { type: String, required: true, trim: true },
        },
        { _id: false }
      ),
      default: null,
    },
    followers: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    following: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    blockedUsers: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    notificationPrefs: {
      type: new Schema(
        {
          orderUpdates: { type: Boolean, default: true },
          promotions: { type: Boolean, default: false },
          social: { type: Boolean, default: true },
        },
        { _id: false }
      ),
      default: () => ({ orderUpdates: true, promotions: false, social: true }),
    },
    privacy: {
      type: new Schema(
        {
          showPhone:     { type: Boolean, default: false },
          showAddress:   { type: Boolean, default: false },
          showFavorites: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: () => ({ showPhone: false, showAddress: false, showFavorites: false }),
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
    exp: {
      type: Number,
      default: 0,
      min: 0,
    },
    vipTier: {
      type: String,
      enum: ['none', 'vip', 'vvip', 'vvvip'],
      default: 'none',
    },
    tosAcceptedAt: {
      type: Date,
      default: null,
    },
    tosVersion: {
      type: String,
      default: null,
    },
    tosAcceptedIp: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'users',
  }
)

// Indexes (username/email/phone đã có unique:true trong field definition)
UserSchema.index({ roles: 1 })
UserSchema.index({ isActive: 1 })
UserSchema.index({ vipTier: 1 })

// Validation hooks
UserSchema.pre('save', async function () {
  if (this.roles.length === 0) {
    throw new Error('User phải có ít nhất 1 role')
  }
})

export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema)
