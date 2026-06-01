import { FastifyInstance } from 'fastify'
import { Order, Store } from '../db/index.js'

export async function cronTriggerRoute(app: FastifyInstance) {
  // Called by Render cron job every minute.
  // Auth: simple bearer token from env CRON_SECRET.
  app.post('/internal/cron/tick', async (req, reply) => {
    const secret = process.env.CRON_SECRET
    if (secret && req.headers['authorization'] !== `Bearer ${secret}`) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const now = new Date()
    const results = { autoCancelled: 0 }

    // Auto-cancel pending_store orders that timed out.
    // Skip orders with desiredDeliveryAt in the future (scheduled/pre-order).
    const pendingOrders = await Order.find({
      mainStatus: 'pending_store',
      $or: [
        { desiredDeliveryAt: null },
        { desiredDeliveryAt: { $lte: now } },
      ],
    }).select('_id storeId createdAt desiredDeliveryAt')

    const storeIds = [...new Set(pendingOrders.map((o) => o.storeId.toString()))]
    const stores = await Store.find({ _id: { $in: storeIds } }).select('_id autoCancelMinutes')
    const cancelMinMap = new Map(stores.map((s) => [s._id.toString(), s.autoCancelMinutes ?? 15]))

    const toCancel = pendingOrders.filter((o) => {
      const mins = cancelMinMap.get(o.storeId.toString()) ?? 15
      const ageMs = now.getTime() - o.createdAt.getTime()
      return ageMs >= mins * 60 * 1000
    })

    for (const o of toCancel) {
      await Order.findByIdAndUpdate(o._id, {
        mainStatus: 'cancelled',
        cancelInfo: { by: 'system', reason: 'Quán không xác nhận đơn đúng hạn', at: now },
        $push: { statusHistory: { status: 'cancelled', at: now, by: 'system' } },
      })
      results.autoCancelled++
    }

    return reply.send(results)
  })
}
