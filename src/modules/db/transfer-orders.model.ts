import mongoose, { Schema, Document, Model } from 'mongoose'

export type TransferOrderStatus = 'in_transit' | 'completed' | 'cancelled'

export interface ITransferOrder extends Document {
  ownerId: mongoose.Types.ObjectId
  fromStoreId: mongoose.Types.ObjectId
  toStoreId: mongoose.Types.ObjectId
  items: {
    menuItemId: mongoose.Types.ObjectId
    nameSnapshot: string
    quantity: number
  }[]
  status: TransferOrderStatus
  note?: string
  createdAt: Date
  completedAt?: Date
  cancelledAt?: Date
}

const TransferOrderSchema = new Schema<ITransferOrder>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'ownerId là bắt buộc'],
    },
    fromStoreId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'fromStoreId là bắt buộc'],
    },
    toStoreId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'toStoreId là bắt buộc'],
    },
    items: {
      type: [
        new Schema(
          {
            menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
            nameSnapshot: { type: String, required: true },
            quantity: { type: Number, required: true, min: [1, 'Số lượng tối thiểu 1'] },
          },
          { _id: false }
        ),
      ],
      validate: {
        validator: (v: any[]) => v.length > 0,
        message: 'Phiếu chuyển hàng phải có ít nhất 1 món',
      },
    },
    status: {
      type: String,
      enum: ['in_transit', 'completed', 'cancelled'],
      default: 'in_transit',
    },
    note: { type: String },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'transfer_orders',
  }
)

TransferOrderSchema.index({ fromStoreId: 1, status: 1 })
TransferOrderSchema.index({ toStoreId: 1, status: 1 })
TransferOrderSchema.index({ ownerId: 1, createdAt: -1 })

export const TransferOrder: Model<ITransferOrder> =
  mongoose.models.TransferOrder ||
  mongoose.model<ITransferOrder>('TransferOrder', TransferOrderSchema)
