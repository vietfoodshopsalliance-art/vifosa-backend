import { Order } from '../modules/db/orders.model.js'
import { emitOrderStatus } from '../socket/orderEvents.js'

export async function runAutoCompleteOrders() {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000)

  const orders = await Order.find({
    mainStatus: { $in: ['preparing', 'delivering'] },
    statusHistory: {
      $elemMatch: {
        status: 'preparing',
        at: { $lt: threeHoursAgo },
      },
    },
  })

  if (orders.length === 0) return

  for (const order of orders) {
    order.mainStatus = 'completed'
    order.statusHistory.push({ status: 'completed', at: new Date(), by: 'system' })
    await order.save()
    emitOrderStatus(order._id.toString(), 'completed')
  }

  console.log(`[auto-complete] Hoàn thành ${orders.length} đơn hàng quá 3h`)
}
