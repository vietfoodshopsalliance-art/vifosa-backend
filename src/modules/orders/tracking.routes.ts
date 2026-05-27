import { FastifyInstance } from 'fastify'
import mongoose from 'mongoose'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Order, Store, MenuItem } from '../db/index.js'
import type { MainStatus } from '../db/orders.model.js'
import { emitOrderStatus } from '../../socket/orderEvents.js'

export async function trackingRoutes(app: FastifyInstance) {
  // ── GET /orders/:id — khách xem chi tiết đơn ─────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/orders/:id',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params
      if (!mongoose.isValidObjectId(id)) {
        return reply.code(400).send({ error: 'orderId không hợp lệ' })
      }

      const order = await Order.findById(id)
      if (!order) return reply.code(404).send({ error: 'Không tìm thấy đơn hàng' })

      const userId = req.user!.userId
      const isCustomer = order.customerId?.toString() === userId
      const isStoreOwner = await Store.exists({ _id: order.storeId, ownerId: userId, isDeleted: { $ne: true } })

      if (!isCustomer && !isStoreOwner) {
        return reply.code(403).send({ error: 'Bạn không có quyền xem đơn hàng này' })
      }

      const storeDoc = await Store.findById(order.storeId).select('name address phone').lean()
      const storeDetails = storeDoc
        ? { name: storeDoc.name, addressText: storeDoc.address?.text ?? '', phone: (storeDoc as any).phone ?? '' }
        : null

      return reply.send({ order, storeDetails })
    }
  )

  // ── POST /orders/:id/payment/upload-receipt — khách upload biên lai ────────
  app.post<{ Params: { id: string }; Body: { receiptUrl: string } }>(
    '/orders/:id/payment/upload-receipt',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await _getCustomerOrder(req.params.id, req.user!.userId, reply)
      if (!order) return

      if (!['bank_transfer', 'fifty_fifty'].includes(order.paymentMethod)) {
        return reply.code(400).send({ error: 'Chỉ áp dụng cho đơn chuyển khoản' })
      }
      const url = req.body?.receiptUrl?.trim()
      if (!url) return reply.code(400).send({ error: 'receiptUrl là bắt buộc' })

      order.bankTransferReceiptUrl = url
      await order.save()

      return reply.send({ order })
    }
  )

  // ── POST /orders/:id/cancel — khách hủy đơn ──────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/orders/:id/cancel',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await _getCustomerOrder(req.params.id, req.user!.userId, reply)
      if (!order) return

      const cancellable: MainStatus[] = ['pending_store', 'awaiting_payment', 'awaiting_store_open']
      if (!cancellable.includes(order.mainStatus)) {
        return reply.code(409).send({ error: 'Không thể hủy đơn ở trạng thái này' })
      }

      order.mainStatus = 'cancelled'
      order.cancelInfo = { by: 'customer', reason: 'Khách hủy đơn', at: new Date() }
      order.statusHistory.push({ status: 'cancelled', at: new Date(), by: req.user!.userId })
      await order.save()

      return reply.send({ order })
    }
  )

  // ── POST /orders/:id/confirm-received — khách xác nhận đã nhận hàng ──────
  // Chỉ chạy khi quán đã đánh dấu "đã giao" (delivered); khách xác nhận → completed
  app.post<{ Params: { id: string } }>(
    '/orders/:id/confirm-received',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await _getCustomerOrder(req.params.id, req.user!.userId, reply)
      if (!order) return

      if (order.mainStatus !== 'delivered') {
        return reply.code(409).send({ error: 'Đơn hàng chưa được quán xác nhận giao, không thể xác nhận nhận hàng' })
      }

      const now = new Date()
      order.mainStatus = 'completed'
      order.statusHistory.push({ status: 'completed', at: now, by: req.user!.userId })
      if (!order.completedAt) order.completedAt = now
      await order.save()

      // Cập nhật stats của store
      await Store.findByIdAndUpdate(order.storeId, {
        $inc: {
          'stats.completedOrdersThisMonth': 1,
          'stats.totalCompletedOrders': 1,
        },
      })

      // Tăng soldCount cho từng món trong đơn
      const soldBulk = order.items.map((oi: any) => ({
        updateOne: {
          filter: { _id: oi.itemId },
          update: { $inc: { 'soldCount.allTime': oi.qty, 'soldCount.last30d': oi.qty, 'soldCount.last7d': oi.qty } },
        },
      }))
      if (soldBulk.length > 0) await MenuItem.bulkWrite(soldBulk)

      emitOrderStatus(order._id.toString(), 'completed')
      return reply.send({ order })
    }
  )

  // ── POST /orders/:id/report-paid — khách báo đã chuyển khoản ─────────────
  app.post<{ Params: { id: string } }>(
    '/orders/:id/report-paid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await _getCustomerOrder(req.params.id, req.user!.userId, reply)
      if (!order) return

      if (!['bank_transfer', 'fifty_fifty'].includes(order.paymentMethod)) {
        return reply.code(400).send({ error: 'Phương thức thanh toán không hỗ trợ' })
      }
      if (order.paymentStatus !== 'unpaid') {
        return reply.code(409).send({ error: 'Đơn đã có trạng thái thanh toán khác' })
      }

      order.paymentStatus = 'reported_paid'
      await order.save()

      return reply.send({ order })
    }
  )
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function _getCustomerOrder(orderId: string, userId: string, reply: any) {
  if (!mongoose.isValidObjectId(orderId)) {
    reply.code(400).send({ error: 'orderId không hợp lệ' })
    return null
  }
  const order = await Order.findById(orderId)
  if (!order) { reply.code(404).send({ error: 'Không tìm thấy đơn hàng' }); return null }
  if (order.customerId?.toString() !== userId) {
    reply.code(403).send({ error: 'Bạn không phải chủ đơn hàng này' })
    return null
  }
  return order
}
