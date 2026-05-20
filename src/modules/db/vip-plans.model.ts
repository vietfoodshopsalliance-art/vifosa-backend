import mongoose, { Schema, Document, Model } from 'mongoose'

export type VipTier = 'vip' | 'vvip' | 'vvvip'

export interface IVipPlan extends Document {
  tier: VipTier
  name: string
  durationDays: number
  price: number
  benefits: string[]
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const VipPlanSchema = new Schema<IVipPlan>(
  {
    tier: {
      type: String,
      enum: ['vip', 'vvip', 'vvvip'],
      required: [true, 'tier là bắt buộc'],
    },
    name: {
      type: String,
      required: [true, 'name là bắt buộc'],
      trim: true,
      maxlength: [100, 'name tối đa 100 ký tự'],
    },
    durationDays: {
      type: Number,
      required: [true, 'durationDays là bắt buộc'],
      min: [1, 'durationDays tối thiểu 1 ngày'],
    },
    price: {
      type: Number,
      required: [true, 'price là bắt buộc'],
      min: [0, 'price không được âm'],
    },
    benefits: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: 'vip_plans',
  }
)

VipPlanSchema.index({ tier: 1, isActive: 1 })

export const VipPlan: Model<IVipPlan> =
  mongoose.models.VipPlan || mongoose.model<IVipPlan>('VipPlan', VipPlanSchema)
