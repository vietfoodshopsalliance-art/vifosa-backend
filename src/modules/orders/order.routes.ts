import { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, Order } from '../db/index.js'
import { emitOrderStatus } from '../../socket/orderEvents.js'
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
  app.get<{ Params: { storeId: string }; Querystring: { tab?: string; page?: string; limit?: string } }>(
    '/me/stores/:storeId/orders',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.storeId)) {
        return reply.code(400).send({ error: 'storeId không hợp lệ' })
      }
      const store = await Store.findOne({ _id: req.params.storeId, isDeleted: false })
      if (!store) return reply.code(404).send({ error: 'Không tìm thấy quán' })
      if (store.ownerId.toString() !== req.user!.userId) {
        return reply.code(403).send({ error: 'Bạn không phải chủ quán này' })
      }

      const tab = (req.query.tab ?? 'pending') as OrderTab
      const page  = Math.max(1, parseInt(req.query.page  ?? '1'))
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20')))

      const statuses = tabToStatuses(tab)
      const filter = { storeId: store._id, mainStatus: { $in: statuses } }

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

      order.mainStatus = 'completed'
      order.statusHistory.push({ status: 'completed', at: new Date(), by: req.user!.userId })
      await order.save()

      emitOrderStatus(order._id.toString(), 'completed')
      return reply.send(order)
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

  const store = await Store.findOne({ _id: order.storeId, ownerId: userId, isDeleted: false })
  if (!store) { reply.code(403).send({ error: 'Bạn không phải chủ quán của đơn này' }); return null }

  return order
}
