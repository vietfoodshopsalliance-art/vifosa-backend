import mongoose, { Schema, Document, Model } from 'mongoose'

export type MemberRole = 'manager' | 'staff'
export type MemberStatus = 'pending' | 'active' | 'removed'

export type ManagerPermission =
  | 'manage_menu'
  | 'manage_orders'
  | 'manage_opening_hours'
  | 'manage_ship_fee'
  | 'manage_auto_settings'
  | 'emergency_close'
  | 'view_revenue'
  | 'manage_reviews'
  | 'inventory_import'
  | 'manage_staff'

export interface IStoreMembership extends Document {
  storeId: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  role: MemberRole
  permissions: ManagerPermission[]
  status: MemberStatus
  invitedBy: mongoose.Types.ObjectId
  invitedAt: Date
  acceptedAt?: Date
  removedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const StoreMembershipSchema = new Schema<IStoreMembership>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'storeId là bắt buộc'],
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId là bắt buộc'],
    },
    role: {
      type: String,
      enum: ['manager', 'staff'],
      required: [true, 'role là bắt buộc'],
    },
    permissions: {
      type: [String],
      enum: [
        'manage_menu',
        'manage_orders',
        'manage_opening_hours',
        'manage_ship_fee',
        'manage_auto_settings',
        'emergency_close',
        'view_revenue',
        'manage_reviews',
        'inventory_import',
        'manage_staff',
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'removed'],
      default: 'pending',
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'invitedBy là bắt buộc'],
    },
    invitedAt: { type: Date, required: true, default: Date.now },
    acceptedAt: { type: Date },
    removedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'store_memberships',
  }
)

StoreMembershipSchema.index({ storeId: 1, userId: 1, status: 1 })
StoreMembershipSchema.index({ userId: 1 })
StoreMembershipSchema.index({ storeId: 1, status: 1 })

export const StoreMembership: Model<IStoreMembership> =
  mongoose.models.StoreMembership ||
  mongoose.model<IStoreMembership>('StoreMembership', StoreMembershipSchema)
