import mongoose from 'mongoose'
import { Order, Review } from '../modules/db/index.js'
import { PushSender } from '../adapters/push-sender/fcm.adapter.js'

const REMINDER_DELAYS = [
  { key: 'store_1h',    ms: 1  * 60 * 60 * 1000, target: 'store'    as const },
  { key: 'store_3h',    ms: 3  * 60 * 60 * 1000, target: 'store'    as const },
  { key: 'store_6h',   ms: 6  * 60 * 60 * 1000, target: 'store'    as const },
  { key: 'customer_1h', ms: 1  * 60 * 60 * 1000, target: 'customer' as const },
  { key: 'customer_3h', ms: 3  * 60 * 60 * 1000, target: 'customer' as const },
  { key: 'customer_6h', ms: 6  * 60 * 60 * 1000, target: 'customer' as const },
]

// Tolerance: ±10 phút để cron không bỏ sót do timing drift
const TOLERANCE = 10 * 60 * 1000

export async function runReviewReminders() {
  const User = mongoose.models['User'] as any

  for (const reminder of REMINDER_DELAYS) {
    const now = Date.now()
    const windowStart = new Date(now - reminder.ms - TOLERANCE)
    const windowEnd   = new Date(now - reminder.ms + TOLERANCE)

    const orders = await Order.find({
      completedAt: { $gte: windowStart, $lte: windowEnd },
      mainStatus: { $in: ['delivered', 'completed'] },
      _reviewNotifsSent: { $ne: reminder.key },
    }).select('_id customerId storeId _reviewNotifsSent')

    if (!orders.length) continue

    for (const order of orders) {
      // Kiểm tra đã có review chưa
      const existingReview = await Review.findOne({
        orderId: order._id,
        toEntityType: reminder.target,
      }).select('_id')

      if (existingReview) {
        // Đã có review rồi, chỉ mark không cần push
        await Order.updateOne({ _id: order._id }, { $addToSet: { _reviewNotifsSent: reminder.key } })
        continue
      }

      let fcmTokens: string[] = []
      let title: string
      let body: string

      if (reminder.target === 'store') {
        // Nhắc khách review quán
        if (!order.customerId) continue
        const user = await User.findById(order.customerId).select('fcmTokens')
        fcmTokens = user?.fcmTokens ?? []
        title = 'Đánh giá đơn hàng của bạn'
        body  = 'Hãy để lại đánh giá cho quán và giúp cộng đồng nhé!'
      } else {
        // Nhắc chủ quán review khách
        const Store = mongoose.models['Store'] as any
        const store = await Store.findById(order.storeId).select('ownerId')
        if (!store) continue
        const owner = await User.findById(store.ownerId).select('fcmTokens')
        fcmTokens = owner?.fcmTokens ?? []
        title = 'Đánh giá khách hàng'
        body  = 'Bạn có thể đánh giá khách hàng của đơn vừa giao!'
      }

      if (fcmTokens.length) {
        const result = await PushSender.send(fcmTokens, {
          title,
          body,
          data: {
            type: 'review_reminder',
            orderId: order._id.toString(),
            target: reminder.target,
          },
        })

        // Dọn token hết hạn
        if (result.invalidTokens.length) {
          await User.updateMany(
            {},
            { $pull: { fcmTokens: { $in: result.invalidTokens } } }
          )
        }
      }

      await Order.updateOne({ _id: order._id }, { $addToSet: { _reviewNotifsSent: reminder.key } })
    }
  }
}
