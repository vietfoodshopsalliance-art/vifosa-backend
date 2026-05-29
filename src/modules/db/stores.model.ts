import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IStore extends Document {
  ownerId: mongoose.Types.ObjectId
  name: string
  description: string
  phone?: string
  coverImage: string | null
  coverImages: string[]
  avatarImage: string | null
  address: {
    text: string
    location: {
      type: 'Point'
      coordinates: [number, number] // [lng, lat]
    }
  }
  openingHours: {
    dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6
    open: string
    close: string
    isClosed: boolean
  }[]
  isOpen: boolean
  emergencyClosed: boolean
  bankAccount: {
    number: string
    bank: string
    holder: string
    qrImage?: string
  } | null
  paymentMethods: {
    bankTransfer: boolean
    cod: boolean
    fiftyFifty: boolean
  }
  shipFeeFormula: {
    a: number
    b: number
    c: number
  }
  autoConfirmMinutes: number
  autoCancelMinutes: number
  isAdLockedByAdmin: boolean
  isSuspended: boolean
  vipTier: 'none' | 'vip' | 'vvip' | 'vvvip'
  vipExpiresAt: Date | null
  vipAutoRenew: boolean
  stats: {
    completedOrdersThisMonth: number
    avgRating: number
    totalReviews: number
  }
  isDeleted: boolean
  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const PointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90,
        message: 'Toạ độ không hợp lệ. Phải là [lng, lat]',
      },
    },
  },
  { _id: false }
)

const OpeningHourSchema = new Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    open: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ mở phải có dạng HH:MM'],
      default: '08:00',
    },
    close: {
      type: String,
      required: true,
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Giờ đóng phải có dạng HH:MM'],
      default: '22:00',
    },
    isClosed: { type: Boolean, default: false },
  },
  { _id: false }
)

const StoreSchema = new Schema<IStore>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'ownerId là bắt buộc'],
    },
    name: {
      type: String,
      required: [true, 'Tên quán là bắt buộc'],
      trim: true,
      minlength: [2, 'Tên quán tối thiểu 2 ký tự'],
      maxlength: [100, 'Tên quán tối đa 100 ký tự'],
    },
    description: {
      type: String,
      default: '',
      maxlength: [1000, 'Mô tả tối đa 1000 ký tự'],
    },
    phone: {
      type: String,
      default: '',
      trim: true,
      maxlength: [20, 'SĐT tối đa 20 ký tự'],
    },
    coverImage: { type: String, default: null },
    coverImages: { type: [String], default: [] },
    avatarImage: { type: String, default: null },
    address: {
      type: new Schema(
        {
          text: { type: String, required: true, trim: true },
          location: { type: PointSchema, required: true },
        },
        { _id: false }
      ),
      required: [true, 'Địa chỉ là bắt buộc'],
    },
    openingHours: {
      type: [OpeningHourSchema],
      validate: {
        validator: (v: any[]) => {
          if (!v || v.length === 0) return true
          const days = v.map((h) => h.dayOfWeek)
          return new Set(days).size === days.length
        },
        message: 'Không được trùng ngày trong openingHours',
      },
      default: () =>
        [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          dayOfWeek: d,
          open: '08:00',
          close: '22:00',
          isClosed: d === 0, // Chủ nhật đóng mặc định
        })),
    },
    isOpen: { type: Boolean, default: false },
    emergencyClosed: { type: Boolean, default: false },
    bankAccount: {
      type: new Schema(
        {
          number: { type: String, default: "", trim: true },
          bank: { type: String, default: "", trim: true },
          holder: { type: String, default: "", trim: true },
          qrImage: { type: String },
        },
        { _id: false }
      ),
      default: null,
    },
    paymentMethods: {
      type: new Schema(
        {
          bankTransfer: { type: Boolean, default: true },
          cod: { type: Boolean, default: false },
          fiftyFifty: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: () => ({ bankTransfer: true, cod: false, fiftyFifty: false }),
    },
    shipFeeFormula: {
      type: new Schema(
        {
          a: { type: Number, required: true, min: 0, default: 12000 },
          b: { type: Number, required: true, min: 0, default: 5000 },
          c: { type: Number, required: true, min: 0, max: 100, default: 0 },
        },
        { _id: false }
      ),
      default: () => ({ a: 12000, b: 5000, c: 0 }),
    },
    autoConfirmMinutes: {
      type: Number,
      default: 0,
      min: [0, 'autoConfirmMinutes không được âm'],
    },
    autoCancelMinutes: {
      type: Number,
      default: 15,
      min: [1, 'autoCancelMinutes tối thiểu 1 phút'],
    },
    isAdLockedByAdmin: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    vipTier: {
      type: String,
      enum: ['none', 'vip', 'vvip', 'vvvip'],
      default: 'none',
    },
    vipExpiresAt: { type: Date, default: null },
    vipAutoRenew: { type: Boolean, default: false },
    stats: {
      type: new Schema(
        {
          completedOrdersThisMonth: { type: Number, default: 0, min: 0 },
          avgRating: { type: Number, default: 0, min: 0, max: 5 },
          totalReviews: { type: Number, default: 0, min: 0 },
        },
        { _id: false }
      ),
      default: () => ({ completedOrdersThisMonth: 0, avgRating: 0, totalReviews: 0 }),
    },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'stores',
  }
)

// Indexes
StoreSchema.index({ 'address.location': '2dsphere' })
StoreSchema.index({ ownerId: 1 })
StoreSchema.index({ vipTier: 1 })
StoreSchema.index({ vipExpiresAt: 1 })

export const Store: Model<IStore> = mongoose.models.Store || mongoose.model<IStore>('Store', StoreSchema)
