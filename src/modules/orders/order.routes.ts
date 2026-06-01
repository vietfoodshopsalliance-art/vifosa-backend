import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, Order, MenuItem } from '../db/index.js'
import { emitOrderStatus, emitPaymentStatus } from '../../socket/orderEvents.js'
import mongoose from 'mongoose'
import type { MainStatus } from '../db/orders.model.js'

function _haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return parseFloat((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2))
}

function _genCode(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const l1 = alpha[Math.floor(Math.random() * alpha.length)]
  const l2 = alpha[Math.floor(Math.random() * alpha.length)]
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `${l1}${l2}${yy}${mm}${dd}-${seq}`
}

// "Chờ xử lý" tab
const PENDING_STATUSES: MainStatus[] = ['pending_store', 'awaiting_payment', 'awaiting_store_open']
// "Đang làm" tab
const ACTIVE_STATUSES: MainStatus[] = ['preparing', 'delivering', 'delivered']
// "Lịch sử" tab
const HISTORY_STATUSES: MainStatus[] = ['completed', 'cancelled']

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

  // ── PATCH /orders/:orderId/mark-delivered ────────────────────────────────
  // Quán xác nhận "đã trao hàng tận tay" — delivering → delivered (chờ khách xác nhận)
  app.patch<{ Params: { orderId: string } }>(
    '/orders/:orderId/mark-delivered',
    { preHandler: requireAuth },
    async (req, reply) => {
      const order = await getOrderForStore(req.params.orderId, req.user!.userId, reply)
      if (!order) return

      if (order.mainStatus !== 'delivering') {
        return reply.code(409).send({ error: `Đơn đang ở trạng thái "${order.mainStatus}", cần "delivering" để đánh dấu đã giao` })
      }

      order.mainStatus = 'delivered'
      order.statusHistory.push({ status: 'delivered', at: new Date(), by: req.user!.userId })
      await order.save()

      emitOrderStatus(order._id.toString(), 'delivered')
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

      // Tăng soldCount cho từng món trong đơn
      const soldBulk = order.items.map((oi: any) => ({
        updateOne: {
          filter: { _id: oi.itemId },
          update: { $inc: { 'soldCount.allTime': oi.qty, 'soldCount.last30d': oi.qty, 'soldCount.last7d': oi.qty } },
        },
      }))
      if (soldBulk.length > 0) await MenuItem.bulkWrite(soldBulk)

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

  // ── POST /me/stores/:storeId/orders/manual — Chủ quán tạo đơn thủ công ────
  // Dành cho: khách vãng lai, đặt qua SĐT, Facebook, Grab, Shopee ngoài app
  app.post<{ Params: { storeId: string }; Body: any }>(
    '/me/stores/:storeId/orders/manual',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.storeId)) {
        return reply.code(400).send({ error: 'storeId không hợp lệ' })
      }
      const store = await Store.findOne({ _id: req.params.storeId, isDeleted: { $ne: true } })
      if (!store) return reply.code(404).send({ error: 'Không tìm thấy quán' })
      if (store.ownerId.toString() !== req.user!.userId) {
        return reply.code(403).send({ error: 'Bạn không phải chủ quán này' })
      }

      const body = req.body as Record<string, any>

      if (!Array.isArray(body.items) || body.items.length === 0) {
        return reply.code(400).send({ error: 'Đơn hàng cần ít nhất 1 món' })
      }

      const paymentMethod: string = body.paymentMethod ?? 'bank_transfer'
      if (!['bank_transfer', 'cod', 'collect_later'].includes(paymentMethod)) {
        return reply.code(400).send({ error: 'Phương thức thanh toán không hợp lệ' })
      }

      const deliveryMethod: string = body.deliveryMethod ?? 'self_pickup'
      if (!['store_delivery', 'self_pickup'].includes(deliveryMethod)) {
        return reply.code(400).send({ error: 'deliveryMethod không hợp lệ' })
      }

      // ── Fetch & validate items ──────────────────────────────────────────────
      const itemIds = (body.items as any[])
        .map((i: any) => i.itemId)
        .filter((id: any) => mongoose.isValidObjectId(id))

      const menuItems = await MenuItem.find({
        _id: { $in: itemIds },
        storeId: req.params.storeId,
        isDeleted: { $ne: true },
      })
      const menuMap = new Map(menuItems.map((m) => [m._id.toString(), m]))

      const orderItems: { itemId: mongoose.Types.ObjectId; nameSnapshot: string; priceSnapshot: number; qty: number; note: string }[] = []
      let itemsTotal = 0

      for (const i of body.items as any[]) {
        const menu = menuMap.get(i.itemId?.toString())
        if (!menu) return reply.code(400).send({ error: 'Món không tồn tại hoặc không thuộc quán này' })
        const qty = Math.max(1, parseInt(String(i.qty ?? i.quantity ?? 1)))
        orderItems.push({
          itemId: menu._id as mongoose.Types.ObjectId,
          nameSnapshot: menu.name,
          priceSnapshot: menu.price,
          qty,
          note: (i.note ?? '').toString().trim(),
        })
        itemsTotal += menu.price * qty
      }

      // ── Delivery address & ship fee ─────────────────────────────────────────
      const isSelfPickup = deliveryMethod === 'self_pickup'
      const storeCoords = store.address?.location?.coordinates as [number, number] | undefined
      const storeLng = storeCoords?.[0] ?? 0
      const storeLat = storeCoords?.[1] ?? 0

      let deliveryText: string
      let deliveryLng = storeLng
      let deliveryLat = storeLat

      if (isSelfPickup) {
        deliveryText = store.address?.text || 'Đến lấy tại quán'
      } else {
        deliveryText = (body.deliveryAddress?.text ?? '').toString().trim()
        if (!deliveryText) return reply.code(400).send({ error: 'Cần địa chỉ giao hàng' })
        const clientCoords = body.deliveryAddress?.location?.coordinates
        if (Array.isArray(clientCoords) && clientCoords.length >= 2) {
          deliveryLng = Number(clientCoords[0])
          deliveryLat = Number(clientCoords[1])
        }
      }

      const distanceKm = isSelfPickup ? 0 : _haversineKm(storeLat, storeLng, deliveryLat, deliveryLng)

      let shipFee = 0
      if (!isSelfPickup) {
        const manualFee = parseFloat(String(body.shipFee ?? 0))
        shipFee = isNaN(manualFee) ? 0 : Math.max(0, Math.round(manualFee / 1000) * 1000)
      }

      // ── Bank snapshot (chỉ cần cho bank_transfer) ───────────────────────────
      const storeBankSnapshot = store.bankAccount?.number
        ? { number: store.bankAccount.number, bank: store.bankAccount.bank ?? '', holder: store.bankAccount.holder ?? '' }
        : null

      // ── GuestInfo — tên/SĐT của khách (tùy chọn, có placeholder nếu không điền) ─
      const guestName = body.guestInfo?.name?.toString().trim() || 'Khách vãng lai'
      const rawPhone = body.guestInfo?.phone?.toString().trim() || ''
      const guestPhone = /^0[0-9]{9}$/.test(rawPhone) ? rawPhone : '0000000000'
      const guestInfo = { name: guestName, phone: guestPhone }

      const paymentStatus = paymentMethod === 'cod' ? 'cod_pending' : 'unpaid'

      // ── Ngày nhận hàng ─────────────────────────────────────────────────────
      let desiredDeliveryAt: Date | null = null
      if (body.desiredDeliveryAt) {
        const parsed = new Date(body.desiredDeliveryAt)
        if (!isNaN(parsed.getTime())) desiredDeliveryAt = parsed
      }

      // ── Tạo đơn ────────────────────────────────────────────────────────────
      let code = _genCode()
      while (await Order.exists({ code })) { code = _genCode() }
      const trackingToken = crypto.randomBytes(16).toString('hex')

      const order = new Order({
        code,
        trackingToken,
        customerId: null,
        guestInfo,
        storeId: store._id,
        receiver: { name: guestName, phone: guestPhone, isSelfReceiver: isSelfPickup },
        items: orderItems,
        itemsTotal,
        shipFee,
        shipFeeFormulaSnapshot: { a: 0, b: 0, c: 0, distanceKm },
        totalAmount: itemsTotal + shipFee,
        paymentMethod,
        storeBankSnapshot: paymentMethod === 'bank_transfer' ? storeBankSnapshot : null,
        paymentStatus,
        deliveryMethod,
        deliveryAddress: {
          text: deliveryText,
          location: { type: 'Point', coordinates: [deliveryLng, deliveryLat] },
        },
        distanceKm,
        customerNote: (body.customerNote ?? '').toString().trim(),
        mainStatus: 'pending_store',
        isPreOrder: false,
        desiredDeliveryAt,
        statusHistory: [{ status: 'pending_store', at: new Date(), by: req.user!.userId }],
      })

      try {
        await order.save()
      } catch (err: any) {
        return reply.code(400).send({ error: err.message ?? 'Lỗi tạo đơn hàng' })
      }

      return reply.code(201).send({ order })
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
