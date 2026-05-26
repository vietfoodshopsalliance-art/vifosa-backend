import { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, Order } from '../db/index.js'
import { emitOrderStatus, emitPaymentStatus } from '../../socket/orderEvents.js'
import mongoose from 'mongoose'
import type { MainStatus } from '../db/orders.model.js'

// "Chờ xử lý" tab
const PENDING_STATUSES: MainStatus[] = ['pending_store', 'awaiting_payment', 'awaiting_store_open']
// "Đang làm" tab
const ACTIVE_STATUSES: MainStatus[] = ['preparing', 'delivering']
// "Lịch sử" tab
const HISTORY_STATUSES: MainStatus[] = ['delivered', 'completed', 'cancelled']

type OrderTab = 'pending' | 'active' | 'history'

function tabToStatuses(tab: OrderTab): MainStatus[] {
  if (tab === 'pending') return PENDING_STATUSES
  if (tab === 'active')  return ACTIVE_STATUSES
  return HISTORY_STATUSES
}

export async function orderRoutes(app: FastifyInstance) {
  // ── GET /me/stores/:storeId/orders ────────────────────────────────────────
  // Query: tab=pending|active|history (default: pending), page, limit
  app.get<{ Params: { storeId: string }; Querystring: { tab?: string; page?: string; limit?: string; dateFrom?: string; dateTo?: string } }>(
    '/me/stores/:storeId/orders',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.storeId)) {
        return reply.code(400).send({ error: 'storeId không hợp lệ' })
      }
      const store = await Store.findOne({ _id: req.params.storeId, isDeleted: { $ne: true } })
      if (!store) return reply.code(404).send({ error: 'Không tìm thấy quán' })
      if (store.ownerId.toString() !== req.user!.userId) {
        req.log.warn({ storeId: req.params.storeId, storeOwnerId: store.ownerId.toString(), requestUserId: req.user!.userId }, '[orderRoutes] 403 owner mismatch')
        return reply.code(403).send({ error: 'Bạn không phải chủ quán này' })
      }

      const tab = (req.query.tab ?? 'pending') as OrderTab
      const page  = Math.max(1, parseInt(req.query.page  ?? '1'))
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '20')))

      const statuses = tabToStatuses(tab)
      const filter: any = { storeId: store._id, mainStatus: { $in: statuses } }

      if (req.query.dateFrom || req.query.dateTo) {
        filter.createdAt = {}
        if (req.query.dateFrom) filter.createdAt.$gte = new Date(req.query.dateFrom)
        if (req.query.dateTo)   filter.createdAt.$lte = new Date(req.query.dateTo)
      }

      const [orders, total] = await Promise.all([
        Order.find(filter)
          .sort({ createdAt: tab === 'history' ? -1 : 1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Order.countDocuments(filter),
      ])

      return reply.send({ orders, total, page, limit })
    }
  )

  // ── PATCH /orders/:orderId/accept ─────────────────────────────────────────
  app.patch<{ Params: { orderId: string } }>(
    '/orders/:orderId/accept',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await getOrderForStore(req.params.orderId, req.user!.userId, reply)
      if (!order) return

      if (!PENDING_STATUSES.includes(order.mainStatus)) {
        return reply.code(409).send({ error: `Đơn đang ở trạng thái "${order.mainStatus}", không thể xác nhận` })
      }

      order.mainStatus = 'preparing'
      order.statusHistory.push({ status: 'preparing', at: new Date(), by: req.user!.userId })
      await order.save()

      emitOrderStatus(order._id.toString(), 'preparing')
      return reply.send(order)
    }
  )

  // ── PATCH /orders/:orderId/reject ─────────────────────────────────────────
  app.patch<{ Params: { orderId: string }; Body: { reason?: string } }>(
    '/orders/:orderId/reject',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await getOrderForStore(req.params.orderId, req.user!.userId, reply)
      if (!order) return

      if (!PENDING_STATUSES.includes(order.mainStatus)) {
        return reply.code(409).send({ error: `Đơn đang ở trạng thái "${order.mainStatus}", không thể từ chối` })
      }

      order.mainStatus = 'cancelled'
      order.cancelInfo = {
        by: 'store',
        reason: req.body.reason ?? 'Quán từ chối đơn',
        at: new Date(),
      }
      order.statusHistory.push({ status: 'cancelled', at: new Date(), by: req.user!.userId })
      if (order.paymentStatus === 'paid_full' || order.paymentStatus === 'partial') {
        order.refundStatus = 'required'
      }
      await order.save()

      emitOrderStatus(order._id.toString(), 'cancelled')
      return reply.send(order)
    }
  )

  // ── PATCH /orders/:orderId/deliver ────────────────────────────────────────
  app.patch<{ Params: { orderId: string } }>(
    '/orders/:orderId/deliver',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await getOrderForStore(req.params.orderId, req.user!.userId, reply)
      if (!order) return

      if (order.mainStatus !== 'preparing') {
        return reply.code(409).send({ error: `Đơn đang ở trạng thái "${order.mainStatus}", cần ở "preparing" để giao` })
      }

      order.mainStatus = 'delivering'
      order.statusHistory.push({ status: 'delivering', at: new Date(), by: req.user!.userId })
      await order.save()

      emitOrderStatus(order._id.toString(), 'delivering')
      return reply.send(order)
    }
  )

  // ── PATCH /orders/:orderId/complete ───────────────────────────────────────
  app.patch<{ Params: { orderId: string } }>(
    '/orders/:orderId/complete',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await getOrderForStore(req.params.orderId, req.user!.userId, reply)
      if (!order) return

      if (!(['delivering', 'delivered'] as MainStatus[]).includes(order.mainStatus)) {
        return reply.code(409).send({ error: `Đơn đang ở "${order.mainStatus}", cần giao xong mới hoàn thành` })
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

      emitOrderStatus(order._id.toString(), 'completed')
      return reply.send(order)
    }
  )

  // ── PATCH /orders/:orderId/confirm-money-received — quán ghi nhận thu tiền ─
  app.patch<{ Params: { orderId: string }; Body: { amount: number } }>(
    '/orders/:orderId/confirm-money-received',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await getOrderForStore(req.params.orderId, req.user!.userId, reply)
      if (!order) return

      const amount = Number(req.body?.amount)
      if (!amount || amount <= 0) {
        return reply.code(400).send({ error: 'amount phải lớn hơn 0' })
      }

      order.paidAmount = (order.paidAmount ?? 0) + amount

      const remaining = order.totalAmount - order.paidAmount
      if (order.paymentMethod === 'cod') {
        order.paymentStatus = remaining <= 0 ? 'cod_collected' : 'partial'
      } else {
        order.paymentStatus = remaining <= 0 ? 'paid_full' : 'partial'
      }

      await order.save()
      emitPaymentStatus(order._id.toString(), order.paymentStatus)
      return reply.send({ order })
    }
  )

  // ── PATCH /orders/:orderId/return-to-pending — quán trả đơn về chờ xử lý ──
  app.patch<{ Params: { orderId: string } }>(
    '/orders/:orderId/return-to-pending',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await getOrderForStore(req.params.orderId, req.user!.userId, reply)
      if (!order) return

      const returnable: MainStatus[] = ['preparing', 'delivering']
      if (!returnable.includes(order.mainStatus)) {
        return reply.code(409).send({ error: `Đơn đang ở trạng thái "${order.mainStatus}", không thể trả về chờ xử lý` })
      }

      order.mainStatus = 'pending_store'
      order.statusHistory.push({ status: 'pending_store', at: new Date(), by: req.user!.userId })
      await order.save()

      emitOrderStatus(order._id.toString(), 'pending_store')
      return reply.send(order)
    }
  )

  // ── POST /orders/:orderId/food-photos — quán upload ảnh món/giao hàng ─────
  app.post<{ Params: { orderId: string }; Body: { photoUrl: string } }>(
    '/orders/:orderId/food-photos',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await getOrderForStore(req.params.orderId, req.user!.userId, reply)
      if (!order) return

      const url = req.body?.photoUrl?.trim()
      if (!url) return reply.code(400).send({ error: 'photoUrl là bắt buộc' })

      order.foodPhotos.push(url)
      await order.save()

      emitOrderStatus(order._id.toString(), order.mainStatus)
      return reply.send({ order })
    }
  )
}

// ── Helper ────────────────────────────────────────────────────────────────────

async function getOrderForStore(orderId: string, userId: string, reply: any) {
  if (!mongoose.isValidObjectId(orderId)) {
    reply.code(400).send({ error: 'orderId không hợp lệ' })
    return null
  }
  const order = await Order.findById(orderId)
  if (!order) { reply.code(404).send({ error: 'Không tìm thấy đơn hàng' }); return null }

  const store = await Store.findOne({ _id: order.storeId, ownerId: userId, isDeleted: { $ne: true } })
  if (!store) { reply.code(403).send({ error: 'Bạn không phải chủ quán của đơn này' }); return null }

  return order
}
