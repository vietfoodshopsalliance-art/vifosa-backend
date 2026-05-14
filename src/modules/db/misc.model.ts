import mongoose, { Schema, Document, Model } from 'mongoose'

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface IReport extends Document {
  reporterId: mongoose.Types.ObjectId
  targetType: 'post' | 'comment' | 'review' | 'user' | 'store' | 'order'
  targetId: mongoose.Types.ObjectId
  reason: 'spam' | 'misinformation' | 'harassment' | 'fraud' | 'other'
  description: string
  images: string[]
  status: 'open' | 'in_review' | 'resolved' | 'rejected'
  resolverId: mongoose.Types.ObjectId | null
  resolution: string | null
  createdAt: Date
  resolvedAt: Date | null
}

const ReportSchema = new Schema<IReport>(
  {
    reporterId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'reporterId là bắt buộc'],
    },
    targetType: {
      type: String,
      enum: ['post', 'comment', 'review', 'user', 'store', 'order'],
      required: [true, 'targetType là bắt buộc'],
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: [true, 'targetId là bắt buộc'],
    },
    reason: {
      type: String,
      enum: ['spam', 'misinformation', 'harassment', 'fraud', 'other'],
      required: [true, 'Lý do báo cáo là bắt buộc'],
    },
    description: {
      type: String,
      default: '',
      maxlength: [2000, 'Mô tả tối đa 2000 ký tự'],
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 5,
        message: 'Tối đa 5 ảnh bằng chứng',
      },
    },
    status: {
      type: String,
      enum: ['open', 'in_review', 'resolved', 'rejected'],
      default: 'open',
    },
    resolverId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolution: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'reports',
  }
)

ReportSchema.index({ status: 1, createdAt: -1 })
ReportSchema.index({ targetType: 1, targetId: 1 })
ReportSchema.index({ reporterId: 1 })

export const Report: Model<IReport> =
  mongoose.models.Report || mongoose.model<IReport>('Report', ReportSchema)

// ─── Support Tickets ─────────────────────────────────────────────────────────

export interface ISupportTicket extends Document {
  userId: mongoose.Types.ObjectId | null
  guestPhone: string | null
  subject: string
  body: string
  images: string[]
  relatedOrderCode: string | null
  status: 'open' | 'replied' | 'closed'
  adminReply: string | null
  repliedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    guestPhone: {
      type: String,
      default: null,
      match: [/^(0[0-9]{9})?$/, 'SĐT không hợp lệ'],
    },
    subject: {
      type: String,
      required: [true, 'Tiêu đề là bắt buộc'],
      trim: true,
      maxlength: [200, 'Tiêu đề tối đa 200 ký tự'],
    },
    body: {
      type: String,
      required: [true, 'Nội dung là bắt buộc'],
      maxlength: [5000, 'Nội dung tối đa 5000 ký tự'],
    },
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 5,
        message: 'Tối đa 5 ảnh đính kèm',
      },
    },
    relatedOrderCode: { type: String, default: null },
    status: {
      type: String,
      enum: ['open', 'replied', 'closed'],
      default: 'open',
    },
    adminReply: { type: String, default: null },
    repliedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: 'support_tickets',
  }
)

SupportTicketSchema.index({ status: 1, createdAt: -1 })
SupportTicketSchema.index({ userId: 1 })
SupportTicketSchema.index({ guestPhone: 1 })

SupportTicketSchema.pre('save', function (next) {
  if (!this.userId && !this.guestPhone) {
    return next(new Error('Support ticket phải có userId hoặc guestPhone'))
  }
  next()
})

export const SupportTicket: Model<ISupportTicket> =
  mongoose.models.SupportTicket || mongoose.model<ISupportTicket>('SupportTicket', SupportTicketSchema)

// ─── Audit Logs ──────────────────────────────────────────────────────────────

export interface IAuditLog extends Document {
  actorId: mongoose.Types.ObjectId
  actorRole: string
  action: string
  targetType: string
  targetId: mongoose.Types.ObjectId | null
  before: Record<string, any> | null
  after: Record<string, any> | null
  ip: string
  userAgent: string
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'actorId là bắt buộc'],
    },
    actorRole: {
      type: String,
      required: [true, 'actorRole là bắt buộc'],
    },
    action: {
      type: String,
      required: [true, 'action là bắt buộc'],
      maxlength: [100, 'action tối đa 100 ký tự'],
    },
    targetType: {
      type: String,
      required: [true, 'targetType là bắt buộc'],
    },
    targetId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'audit_logs',
  }
)

AuditLogSchema.index({ actorId: 1, createdAt: -1 })
AuditLogSchema.index({ targetType: 1, targetId: 1 })
AuditLogSchema.index({ createdAt: -1 })

export const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema)

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ISetting extends Document {
  key: string
  value: any
  description: string
  updatedBy: mongoose.Types.ObjectId | null
  updatedAt: Date
}

const SettingSchema = new Schema<ISetting>(
  {
    key: {
      type: String,
      required: [true, 'key là bắt buộc'],
      unique: true,
      trim: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: [true, 'value là bắt buộc'],
    },
    description: { type: String, default: '' },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    collection: 'settings',
  }
)

// Index đã có qua unique:true trong field definition

export const Setting: Model<ISetting> =
  mongoose.models.Setting || mongoose.model<ISetting>('Setting', SettingSchema)

// ─── Notifications ───────────────────────────────────────────────────────────

export type NotificationType =
  | 'order_status'
  | 'order_new'
  | 'order_deadline'
  | 'order_alert'
  | 'payment_action'
  | 'refund_action'
  | 'refund_status'
  | 'refund_alert'
  | 'refund_dispute'
  | 'refund_overdue'
  | 'review'
  | 'review_reminder'
  | 'social'
  | 'account'
  | 'account_critical'
  | 'moderation'
  | 'system'

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId
  type: NotificationType
  title: string
  body: string
  data: Record<string, any>
  readAt: Date | null
  createdAt: Date
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId là bắt buộc'],
    },
    type: {
      type: String,
      enum: [
        'order_status',
        'order_new',
        'order_deadline',
        'order_alert',
        'payment_action',
        'refund_action',
        'refund_status',
        'refund_alert',
        'refund_dispute',
        'refund_overdue',
        'review',
        'review_reminder',
        'social',
        'account',
        'account_critical',
        'moderation',
        'system',
      ],
      required: [true, 'type là bắt buộc'],
    },
    title: {
      type: String,
      required: [true, 'title là bắt buộc'],
      maxlength: [200, 'title tối đa 200 ký tự'],
    },
    body: {
      type: String,
      required: [true, 'body là bắt buộc'],
      maxlength: [500, 'body tối đa 500 ký tự'],
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'notifications',
  }
)

NotificationSchema.index({ userId: 1, createdAt: -1 })
NotificationSchema.index({ userId: 1, readAt: 1 })

export const Notification: Model<INotification> =
  mongoose.models.Notification || mongoose.model<INotification>('Notification', NotificationSchema)

// ─── Addresses ───────────────────────────────────────────────────────────────

export interface IAddress extends Document {
  userId: mongoose.Types.ObjectId
  label: string
  address: {
    text: string
    location: {
      type: 'Point'
      coordinates: [number, number]
    }
  }
  receiver: {
    name: string
    phone: string
  }
  isDefault: boolean
  createdAt: Date
  updatedAt: Date
}

const AddressSchema = new Schema<IAddress>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId là bắt buộc'],
    },
    label: {
      type: String,
      default: '',
      maxlength: [50, 'Label tối đa 50 ký tự'],
    },
    address: {
      type: new Schema(
        {
          text: { type: String, required: true, trim: true },
          location: {
            type: new Schema(
              {
                type: { type: String, enum: ['Point'], default: 'Point' },
                coordinates: {
                  type: [Number],
                  required: true,
                  validate: {
                    validator: (v: number[]) =>
                      v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90,
                    message: 'Toạ độ không hợp lệ',
                  },
                },
              },
              { _id: false }
            ),
            required: true,
          },
        },
        { _id: false }
      ),
      required: true,
    },
    receiver: {
      type: new Schema(
        {
          name: { type: String, required: true, trim: true },
          phone: {
            type: String,
            required: true,
            match: [/^0[0-9]{9}$/, 'SĐT không hợp lệ'],
          },
        },
        { _id: false }
      ),
      required: true,
    },
    isDefault: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    collection: 'addresses',
  }
)

AddressSchema.index({ userId: 1, isDefault: 1 })
AddressSchema.index({ 'address.location': '2dsphere' })

export const Address: Model<IAddress> =
  mongoose.models.Address || mongoose.model<IAddress>('Address', AddressSchema)
