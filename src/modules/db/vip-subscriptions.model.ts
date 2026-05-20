import mongoose, { Schema, Document, Model } from 'mongoose'
import type { VipTier } from './vip-plans.model.js'

export type VipSubscriptionStatus =
  | 'pending_payment'
  | 'active'
  | 'expired'
  | 'cancelled'
  | 'failed'

export interface IVipSubscription extends Document {
  storeId: mongoose.Types.ObjectId
  ownerId: mongoose.Types.ObjectId
  planId: mongoose.Types.ObjectId
  tier: VipTier
  durationDays: number
  pricePaid: number
  status: VipSubscriptionStatus

  // SePay integration
  sePayOrderCode: string
  sePayTransactionId?: string
  sePayWebhookPayload?: Record<string, any>
  sePayConfirmedAt?: Date

  // Timeline
  startedAt?: Date
  expiresAt?: Date

  // Admin action
  cancelledBy?: mongoose.Types.ObjectId
  cancelReason?: string

  createdAt: Date
  updatedAt: Date
}

const VipSubscriptionSchema = new Schema<IVipSubscription>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'storeId là bắt buộc'],
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'ownerId là bắt buộc'],
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: 'VipPlan',
      required: [true, 'planId là bắt buộc'],
    },
    tier: {
      type: String,
      enum: ['vip', 'vvip', 'vvvip'],
      required: [true, 'tier là bắt buộc'],
    },
    durationDays: {
      type: Number,
      required: [true, 'durationDays là bắt buộc'],
      min: 1,
    },
    pricePaid: {
      type: Number,
      required: [true, 'pricePaid là bắt buộc'],
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending_payment', 'active', 'expired', 'cancelled', 'failed'],
      default: 'pending_payment',
    },

    sePayOrderCode: {
      type: String,
      required: [true, 'sePayOrderCode là bắt buộc'],
      unique: true,
    },
    sePayTransactionId: { type: String },
    sePayWebhookPayload: { type: Schema.Types.Mixed },
    sePayConfirmedAt: { type: Date },

    startedAt: { type: Date },
    expiresAt: { type: Date },

    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelReason: { type: String },
  },
  {
    timestamps: true,
    collection: 'vip_subscriptions',
  }
)

VipSubscriptionSchema.index({ storeId: 1, status: 1, createdAt: -1 })
// sePayOrderCode đã có unique:true trong field definition
VipSubscriptionSchema.index({ status: 1, expiresAt: 1 })
VipSubscriptionSchema.index({ ownerId: 1, createdAt: -1 })

export const VipSubscription: Model<IVipSubscription> =
  mongoose.models.VipSubscription ||
  mongoose.model<IVipSubscription>('VipSubscription', VipSubscriptionSchema)
