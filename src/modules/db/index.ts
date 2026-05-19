/** C:\Users\Admin\develop\vifosa\backend\src\modules\db\index.ts
 * Entry point cho toàn bộ Mongoose models của Vifosa
 * Import từ đây trong toàn bộ codebase backend:
 *   import { User, Store, Order, ... } from '@/modules/db'
 */

export { User } from './users.model.js'
export type { IUser } from './users.model.js'

export { Store } from './stores.model.js'
export type { IStore } from './stores.model.js'

export { MenuCategory, MenuItem } from './menu.model.js'
export type { IMenuCategory, IMenuItem } from './menu.model.js'

export { Order } from './orders.model.js'
export type {
  IOrder,
  MainStatus,
  PaymentStatus,
  RefundStatus,
  PaymentMethod,
  DeliveryMethod,
} from './orders.model.js'

export { Review, Post, Comment, Like } from './social.model.js'
export type { IReview, IPost, IComment, ILike } from './social.model.js'

export { Report } from './social.model.js'
export { SupportTicket, AuditLog, Setting, Notification, Address } from './misc.model.js'
export type { IReport } from './social.model.js'
export type {
  ISupportTicket,
  IAuditLog,
  ISetting,
  INotification,
  NotificationType,
  IAddress,
} from './misc.model.js'

export { DEFAULT_SETTINGS } from './settings.seed.js'

// ─── connectDB ────────────────────────────────────────────────────────────────

import mongoose from 'mongoose'

let isConnected = false

export async function connectDB(): Promise<void> {
  if (isConnected) return

  const uri = process.env.MONGO_URI
  if (!uri) throw new Error('MONGO_URI chưa được khai báo trong .env')

  await mongoose.connect(uri, {
    dbName: 'vifosa',
  })

  isConnected = true
  console.log('✅ MongoDB Atlas connected')
}

export async function seedSettings(): Promise<void> {
  const { Setting, DEFAULT_SETTINGS } = await import('./misc.model.js').then(async (m) => ({
    Setting: m.Setting,
    DEFAULT_SETTINGS: (await import('./settings.seed.js')).DEFAULT_SETTINGS,
  }))

  const ops = DEFAULT_SETTINGS.map((s) => ({
    updateOne: {
      filter: { key: s.key },
      update: { $setOnInsert: s },
      upsert: true,
    },
  }))

  await Setting.bulkWrite(ops)
  console.log(`✅ Settings seeded (${DEFAULT_SETTINGS.length} keys, upsert safe)`)
}
