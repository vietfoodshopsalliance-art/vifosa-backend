import mongoose, { Schema, Document, Model } from 'mongoose'

export type InventoryLogType =
  | 'import'
  | 'order_deduct'
  | 'order_rollback'
  | 'transfer_out'
  | 'transfer_in'
  | 'gifted'
  | 'voided'
  | 'manual_adjust'

export interface IInventoryLog extends Document {
  storeId: mongoose.Types.ObjectId
  menuItemId: mongoose.Types.ObjectId
  itemNameSnapshot: string
  delta: number
  stockBefore: number
  stockAfter: number
  type: InventoryLogType
  refId?: mongoose.Types.ObjectId
  performedBy: mongoose.Types.ObjectId
  reason: string
  note?: string
  attachments?: string[]
  createdAt: Date
}

const InventoryLogSchema = new Schema<IInventoryLog>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'storeId là bắt buộc'],
    },
    menuItemId: {
      type: Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: [true, 'menuItemId là bắt buộc'],
    },
    itemNameSnapshot: {
      type: String,
      required: [true, 'itemNameSnapshot là bắt buộc'],
    },
    delta: { type: Number, required: [true, 'delta là bắt buộc'] },
    stockBefore: { type: Number, required: [true, 'stockBefore là bắt buộc'], min: 0 },
    stockAfter: { type: Number, required: [true, 'stockAfter là bắt buộc'], min: 0 },
    type: {
      type: String,
      enum: ['import', 'order_deduct', 'order_rollback', 'transfer_out', 'transfer_in', 'gifted', 'voided', 'manual_adjust'],
      required: [true, 'type là bắt buộc'],
    },
    refId: { type: Schema.Types.ObjectId },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'performedBy là bắt buộc'],
    },
    reason: { type: String, required: [true, 'reason là bắt buộc'] },
    note: { type: String },
    attachments: { type: [String], default: [] },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'inventory_logs',
  }
)

InventoryLogSchema.index({ storeId: 1, menuItemId: 1, createdAt: -1 })
InventoryLogSchema.index({ storeId: 1, type: 1, createdAt: -1 })
InventoryLogSchema.index({ refId: 1 })

export const InventoryLog: Model<IInventoryLog> =
  mongoose.models.InventoryLog ||
  mongoose.model<IInventoryLog>('InventoryLog', InventoryLogSchema)
