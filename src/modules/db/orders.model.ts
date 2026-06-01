import mongoose, { Schema, Document, Model } from 'mongoose'

export type MainStatus =
  | 'cart'
  | 'created'
  | 'awaiting_payment'
  | 'awaiting_store_open'
  | 'pending_store'
  | 'preparing'
  | 'delivering'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'gifted'
  | 'voided'

export type PaymentStatus =
  | 'unpaid'
  | 'reported_paid'
  | 'partial'
  | 'paid_full'
  | 'cod_pending'
  | 'cod_collected'

export type RefundStatus = 'required' | 'submitted' | 'refunded' | 'disputed'

export type PaymentMethod = 'bank_transfer' | 'cod' | 'fifty_fifty' | 'collect_later'

export type DeliveryMethod = 'store_delivery' | 'self_pickup' | 'customer_shipper'

export interface IOrder extends Document {
  code: string
  trackingToken: string
  customerId: mongoose.Types.ObjectId | null
  guestInfo: {
    name: string
    phone: string
    email?: string
    bankAccountForRefund?: {
      number: string
      bank: string
      holder: string
    }
  } | null
  storeId: mongoose.Types.ObjectId
  receiver: {
    name: string
    phone: string
    isSelfReceiver: boolean
  }
  items: {
    itemId: mongoose.Types.ObjectId
    nameSnapshot: string
    priceSnapshot: number
    qty: number
    note: string
  }[]
  itemsTotal: number
  shipFee: number
  shipFeeFormulaSnapshot: {
    a: number
    b: number
    c: number
    distanceKm: number
  }
  totalAmount: number
  paymentMethod: PaymentMethod
  storeBankSnapshot: {
    number: string
    bank: string
    holder: string
  } | null
  paidAmount: number
  paymentStatus: PaymentStatus
  deliveryMethod: DeliveryMethod
  deliveryAddress: {
    text: string
    location: {
      type: 'Point'
      coordinates: [number, number]
    }
  }
  distanceKm: number
  customerNote: string
  mainStatus: MainStatus
  isPreOrder: boolean
  foodPhotos: string[]
  bankTransferReceiptUrl: string | null
  internalOrderType: 'gift' | 'void' | null
  internalOrderInfo: {
    recipientName?: string
    reason: string
    note?: string
    attachments?: string[]
  } | null
  refundStatus: RefundStatus | null
  refundInfo: {
    submittedAt?: Date
    refundProofImage?: string
    refundedAt?: Date
    bankAccountReceiver: {
      number: string
      bank: string
      holder: string
    }
  } | null
  cancelInfo: {
    by: 'customer' | 'store' | 'system' | 'admin'
    reason: string
    at: Date
  } | null
  statusHistory: {
    status: string
    at: Date
    by: string
  }[]
  completedAt: Date | null
  desiredDeliveryAt: Date | null
  _reviewNotifsSent: string[]
  createdAt: Date
  updatedAt: Date
}

const OrderItemSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    nameSnapshot: { type: String, required: true },
    priceSnapshot: { type: Number, required: true, min: 0 },
    qty: { type: Number, required: true, min: [1, 'Số lượng tối thiểu 1'] },
    note: { type: String, default: '' },
  },
  { _id: false }
)

const PointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false }
)

const OrderSchema = new Schema<IOrder>(
  {
    code: {
      type: String,
      required: [true, 'Mã đơn là bắt buộc'],
      unique: true,
      match: [/^[A-Z]{2}\d{6}-\d{3}$/, 'Mã đơn phải có dạng AB251107-456'],
    },
    trackingToken: {
      type: String,
      required: [true, 'trackingToken là bắt buộc'],
      unique: true,
      minlength: [32, 'trackingToken phải đúng 32 ký tự'],
      maxlength: [32, 'trackingToken phải đúng 32 ký tự'],
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    guestInfo: {
      type: new Schema(
        {
          name: { type: String, required: true, trim: true },
          phone: {
            type: String,
            required: true,
            match: [/^0[0-9]{9}$/, 'SĐT khách vãng lai không hợp lệ'],
          },
          email: { type: String, trim: true, lowercase: true },
          bankAccountForRefund: {
            type: new Schema(
              {
                number: { type: String, required: true },
                bank: { type: String, required: true },
                holder: { type: String, required: true },
              },
              { _id: false }
            ),
          },
        },
        { _id: false }
      ),
      default: null,
    },
    storeId: {
      type: Schema.Types.ObjectId,
      ref: 'Store',
      required: [true, 'storeId là bắt buộc'],
    },
    receiver: {
      type: new Schema(
        {
          name: { type: String, required: true, trim: true },
          phone: {
            type: String,
            required: true,
            match: [/^0[0-9]{9}$/, 'SĐT người nhận không hợp lệ'],
          },
          isSelfReceiver: { type: Boolean, required: true },
        },
        { _id: false }
      ),
      required: true,
    },
    items: {
      type: [OrderItemSchema],
      required: true,
      validate: {
        validator: (v: any[]) => v.length > 0,
        message: 'Đơn hàng phải có ít nhất 1 món',
      },
    },
    itemsTotal: { type: Number, required: true, min: 0 },
    shipFee: { type: Number, required: true, min: 0, default: 0 },
    shipFeeFormulaSnapshot: {
      type: new Schema(
        {
          a: { type: Number, required: true },
          b: { type: Number, required: true },
          c: { type: Number, required: true },
          distanceKm: { type: Number, required: true },
        },
        { _id: false }
      ),
      required: true,
    },
    totalAmount: { type: Number, required: true, min: 0 },
    paymentMethod: {
      type: String,
      enum: ['bank_transfer', 'cod', 'fifty_fifty', 'collect_later'],
      required: [true, 'Phương thức thanh toán là bắt buộc'],
    },
    storeBankSnapshot: {
      type: new Schema(
        {
          number: { type: String, required: true },
          bank: { type: String, required: true },
          holder: { type: String, required: true },
        },
        { _id: false }
      ),
      default: null,
    },
    paidAmount: { type: Number, default: 0, min: 0 },
    foodPhotos: { type: [String], default: [] },
    bankTransferReceiptUrl: { type: String, default: null },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'reported_paid', 'partial', 'paid_full', 'cod_pending', 'cod_collected'],
      default: 'unpaid',
    },
    deliveryMethod: {
      type: String,
      enum: ['store_delivery', 'self_pickup', 'customer_shipper'],
      required: [true, 'Phương thức giao hàng là bắt buộc'],
    },
    deliveryAddress: {
      type: new Schema(
        {
          text: { type: String, required: true },
          location: { type: PointSchema, required: true },
        },
        { _id: false }
      ),
      required: true,
    },
    distanceKm: { type: Number, required: true, min: 0 },
    customerNote: { type: String, default: '' },
    mainStatus: {
      type: String,
      enum: [
        'cart',
        'created',
        'awaiting_payment',
        'awaiting_store_open',
        'pending_store',
        'preparing',
        'delivering',
        'delivered',
        'completed',
        'cancelled',
        'gifted',
        'voided',
      ],
      default: 'created',
    },
    isPreOrder: { type: Boolean, default: false },
    internalOrderType: {
      type: String,
      enum: ['gift', 'void'],
      default: null,
    },
    internalOrderInfo: {
      type: new Schema(
        {
          recipientName: { type: String },
          reason: { type: String, required: true },
          note: { type: String },
          attachments: { type: [String], default: [] },
        },
        { _id: false }
      ),
      default: null,
    },
    refundStatus: {
      type: String,
      enum: ['required', 'submitted', 'refunded', 'disputed'],
      default: null,
    },
    refundInfo: {
      type: new Schema(
        {
          submittedAt: { type: Date },
          refundProofImage: { type: String },
          refundedAt: { type: Date },
          bankAccountReceiver: {
            type: new Schema(
              {
                number: { type: String, required: true },
                bank: { type: String, required: true },
                holder: { type: String, required: true },
              },
              { _id: false }
            ),
            required: true,
          },
        },
        { _id: false }
      ),
      default: null,
    },
    cancelInfo: {
      type: new Schema(
        {
          by: {
            type: String,
            enum: ['customer', 'store', 'system', 'admin'],
            required: true,
          },
          reason: { type: String, required: true },
          at: { type: Date, required: true, default: Date.now },
        },
        { _id: false }
      ),
      default: null,
    },
    statusHistory: {
      type: [
        new Schema(
          {
            status: { type: String, required: true },
            at: { type: Date, required: true, default: Date.now },
            by: { type: String, required: true },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    completedAt: { type: Date, default: null },
    desiredDeliveryAt: { type: Date, default: null },
    _reviewNotifsSent: { type: [String], default: [] },
  },
  {
    timestamps: true,
    collection: 'orders',
  }
)

// Indexes (code/trackingToken đã có unique:true trong field definition)
OrderSchema.index({ customerId: 1, createdAt: -1 })
OrderSchema.index({ storeId: 1, mainStatus: 1, createdAt: -1 })
OrderSchema.index({ 'guestInfo.phone': 1 })
OrderSchema.index({ isPreOrder: 1, mainStatus: 1 })
OrderSchema.index({ refundStatus: 1 })
OrderSchema.index({ storeId: 1, mainStatus: 1, updatedAt: -1 }) // cho cron jobs
OrderSchema.index({ 'items.itemId': 1, mainStatus: 1, createdAt: -1 }) // cho sold count lookup

// Validation hooks
OrderSchema.pre('save', async function () {
  if (!this.customerId && !this.guestInfo) {
    throw new Error('Đơn hàng phải có customerId hoặc guestInfo')
  }
  if (this.distanceKm > 25) {
    throw new Error('Khoảng cách giao hàng vượt quá giới hạn 25km')
  }
  if (this.isPreOrder && this.paymentMethod === 'cod') {
    throw new Error('Pre-order bắt buộc chuyển khoản trước, không thể dùng COD')
  }
  const expectedTotal = this.itemsTotal + this.shipFee
  if (Math.abs(this.totalAmount - expectedTotal) > 1) {
    throw new Error(`totalAmount (${this.totalAmount}) không khớp với itemsTotal + shipFee (${expectedTotal})`)
  }
})


export const Order: Model<IOrder> = mongoose.models.Order || mongoose.model<IOrder>('Order', OrderSchema)
