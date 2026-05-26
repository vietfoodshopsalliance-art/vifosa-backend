import { Order } from '../modules/db/orders.model.js'
import { emitOrderStatus } from '../socket/orderEvents.js'

export async function runAutoCompleteOrders() {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)

  const orders = await Order.find({
    mainStatus: { $in: ['preparing', 'delivering', 'delivered'] },
    statusHistory: {
      $elemMatch: {
        status: 'preparing',
        at: { $lt: threeHoursAgo },
      },
    },
  })

  if (orders.length === 0) return

  for (const order of orders) {
    const now = new Date()
    order.mainStatus = 'completed'
    order.statusHistory.push({ status: 'completed', at: now, by: 'system' })
    if (!order.completedAt) order.completedAt = now
    await order.save()
    emitOrderStatus(order._id.toString(), 'completed')
  }

  console.log(`[auto-complete] Hoàn thành ${orders.length} đơn hàng quá 3h`)
}
