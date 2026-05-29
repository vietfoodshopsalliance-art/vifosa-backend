import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, Order, MenuItem, User } from '../db/index.js'
import type { MainStatus } from '../db/orders.model.js'
import { emitOrderNew } from '../../socket/orderEvents.js'
import { PushSender } from '../../adapters/push-sender/fcm.adapter.js'

// ── Haversine ─────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Order code generator ──────────────────────────────────────────────────────
// Format: [A-Z]{2}YYMMDD-[0-9]{3}  e.g. "VF251204-073"

function genCode(): string {
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

// ─────────────────────────────────────────────────────────────────────────────

export async function cartRoutes(app: FastifyInstance) {
  // ── POST /orders — Khách đặt hàng ────────────────────────────────────────

  app.post<{ Body: any }>('/orders', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.user!.userId
    const body   = req.body as Record<string, any>

    // ── Validate đầu vào cơ bản ───────────────────────────────────────────

    if (!mongoose.isValidObjectId(body.storeId)) {
      return reply.code(400).send({ error: 'storeId không hợp lệ' })
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return reply.code(400).send({ error: 'Đơn hàng cần ít nhất 1 món' })
    }
    if (!body.receiver?.name?.trim() || !body.receiver?.phone?.trim()) {
      return reply.code(400).send({ error: 'Cần họ tên và số điện thoại người nhận' })
    }
    if (!/^0[0-9]{9}$/.test(body.receiver.phone.trim())) {
      return reply.code(400).send({ error: 'Số điện thoại không hợp lệ (phải bắt đầu bằng 0, 10 chữ số)' })
    }

    const deliveryMethod: string = body.deliveryMethod ?? 'store_delivery'
    if (!['store_delivery', 'self_pickup'].includes(deliveryMethod)) {
      return reply.code(400).send({ error: 'deliveryMethod không hợp lệ' })
    }

    const paymentMethod: string = body.paymentMethod ?? 'cod'
    if (!['bank_transfer', 'cod', 'fifty_fifty'].includes(paymentMethod)) {
      return reply.code(400).send({ error: 'paymentMethod không hợp lệ' })
    }

    // ── Fetch quán ────────────────────────────────────────────────────────

    const store = await Store.findOne({ _id: body.storeId, isDeleted: { $ne: true } })
    if (!store) return reply.code(404).send({ error: 'Không tìm thấy quán' })

    // ── Fetch món & build snapshots (dùng giá từ DB, không tin client) ────

    const itemIds = (body.items as any[])
      .map((i: any) => i.itemId)
      .filter((id: any) => mongoose.isValidObjectId(id))

    const menuItems = await MenuItem.find({
      _id: { $in: itemIds },
      storeId: body.storeId,
      isDeleted: { $ne: true },
    })
    const menuMap = new Map(menuItems.map((m) => [m._id.toString(), m]))

    const orderItems: {
      itemId: mongoose.Types.ObjectId
      nameSnapshot: string
      priceSnapshot: number
      qty: number
      note: string
    }[] = []
    let itemsTotal = 0

    for (const i of body.items as any[]) {
      const menu = menuMap.get(i.itemId?.toString())
      if (!menu) {
        return reply.code(400).send({ error: `Món không tồn tại hoặc không thuộc quán này` })
      }
      if (menu.status !== 'active') {
        return reply.code(400).send({ error: `Món "${menu.name}" hiện không có sẵn` })
      }
      const qty = Math.max(1, parseInt(String(i.quantity ?? 1)))
      orderItems.push({
        itemId:        menu._id as mongoose.Types.ObjectId,
        nameSnapshot:  menu.name,
        priceSnapshot: menu.price,
        qty,
        note: '',
      })
      itemsTotal += menu.price * qty
    }

    // ── Tọa độ quán ───────────────────────────────────────────────────────

    const storeCoords = store.address?.location?.coordinates as [number, number] | undefined
    const storeLng = storeCoords?.[0] ?? 0
    const storeLat = storeCoords?.[1] ?? 0

    // ── Tọa độ giao hàng & khoảng cách ───────────────────────────────────

    const isSelfPickup = deliveryMethod === 'self_pickup'

    let deliveryLng = storeLng
    let deliveryLat = storeLat
    let deliveryText: string = body.deliveryAddress?.text?.trim() ?? ''

    if (!isSelfPickup) {
      // Dùng tọa độ khách gửi lên nếu có; fallback tọa độ quán
      const clientCoords = body.deliveryAddress?.location?.coordinates as [number, number] | undefined
      if (clientCoords && clientCoords.length >= 2) {
        deliveryLng = Number(clientCoords[0])
        deliveryLat = Number(clientCoords[1])
      }
      if (!deliveryText) {
        return reply.code(400).send({ error: 'Cần địa chỉ giao hàng' })
      }
    } else {
      deliveryText = deliveryText || store.address?.text || 'Đến lấy tại quán'
    }

    const rawDistKm = haversineKm(storeLat, storeLng, deliveryLat, deliveryLng)
    const distanceKm = isSelfPickup ? 0 : parseFloat(rawDistKm.toFixed(2))

    if (distanceKm > 25) {
      return reply.code(400).send({ error: `Khoảng cách giao hàng ${distanceKm.toFixed(1)} km vượt quá giới hạn 25 km` })
    }

    // ── Phí ship ─────────────────────────────────────────────────────────

    const formula = store.shipFeeFormula ?? { a: 12000, b: 5000, c: 0 }
    const rawFee  = isSelfPickup ? 0 : (formula.a + formula.b * distanceKm) * (1 + formula.c / 100)
    const shipFee = isSelfPickup ? 0 : Math.round(rawFee / 1000) * 1000

    // ── Status ────────────────────────────────────────────────────────────

    const mainStatus  = paymentMethod === 'cod' ? 'pending_store'  : 'awaiting_payment'
    const paymentStatus = paymentMethod === 'cod' ? 'cod_pending' : 'unpaid'

    // ── Bank snapshot (chuyển khoản / 50-50) ─────────────────────────────

    const needsBank = paymentMethod === 'bank_transfer' || paymentMethod === 'fifty_fifty'
    const storeBankSnapshot = needsBank && store.bankAccount?.number
      ? {
          number: store.bankAccount.number,
          bank:   store.bankAccount.bank   ?? '',
          holder: store.bankAccount.holder ?? '',
        }
      : null

    // ── Tạo mã đơn & token ────────────────────────────────────────────────

    let code = genCode()
    while (await Order.exists({ code })) {
      code = genCode()
    }
    const trackingToken = crypto.randomBytes(16).toString('hex') // 32 hex chars

    // ── Tạo đơn hàng ─────────────────────────────────────────────────────

    const order = new Order({
      code,
      trackingToken,
      customerId:  new mongoose.Types.ObjectId(userId),
      guestInfo:   null,
      storeId:     store._id,
      receiver: {
        name:          body.receiver.name.trim(),
        phone:         body.receiver.phone.trim(),
        isSelfReceiver: isSelfPickup,
      },
      items:      orderItems,
      itemsTotal,
      shipFee,
      shipFeeFormulaSnapshot: {
        a:          formula.a,
        b:          formula.b,
        c:          formula.c,
        distanceKm,
      },
      totalAmount:        itemsTotal + shipFee,
      paymentMethod,
      storeBankSnapshot,
      paymentStatus,
      deliveryMethod,
      deliveryAddress: {
        text: deliveryText,
        location: {
          type:        'Point',
          coordinates: [deliveryLng, deliveryLat],
        },
      },
      distanceKm,
      customerNote: (body.customerNote as string | undefined)?.trim() ?? '',
      mainStatus,
      isPreOrder:     false,
      statusHistory: [{ status: mainStatus, at: new Date(), by: userId }],
    })

    try {
      await order.save()
    } catch (err: any) {
      // Lỗi validation từ schema (vd: totalAmount mismatch, distanceKm > 25)
      return reply.code(400).send({ error: err.message ?? 'Lỗi tạo đơn hàng' })
    }

    emitOrderNew(order.storeId.toString(), order)

    User.findById(store.ownerId).select('fcmTokens').lean().then((owner: any) => {
      const tokens: string[] = owner?.fcmTokens ?? []
      if (tokens.length) {
        PushSender.send(tokens, {
          title: 'Đơn hàng mới!',
          body: `${order.code} · ${order.totalAmount.toLocaleString('vi-VN')}đ`,
          data: { type: 'new_order', storeId: order.storeId.toString(), orderId: order._id.toString() },
        }).catch(() => {})
      }
    }).catch(() => {})

    return reply.code(201).send({ order })
  })

  // ── GET /me/orders — lịch sử đơn của khách ───────────────────────────────

  app.get<{ Querystring: { tab?: string; page?: string; limit?: string } }>(
    '/me/orders',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.user!.userId
      const tab    = req.query.tab ?? 'history'
      const page   = Math.max(1, parseInt(req.query.page  ?? '1'))
      const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20')))

      const PENDING: MainStatus[] = ['pending_store', 'awaiting_payment', 'awaiting_store_open']
      const ACTIVE:  MainStatus[] = ['preparing', 'delivering']
      const HISTORY: MainStatus[] = ['delivered', 'completed', 'cancelled']

      const statuses =
        tab === 'pending' ? PENDING :
        tab === 'active'  ? ACTIVE  :
        HISTORY

      const filter = {
        customerId: new mongoose.Types.ObjectId(userId),
        mainStatus: { $in: statuses },
      }

      const [orders, total] = await Promise.all([
        Order.find(filter)
          .populate('storeId', 'name')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Order.countDocuments(filter),
      ])

      return reply.send({ orders, total, page, limit })
    }
  )
}
