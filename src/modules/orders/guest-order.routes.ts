import { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { Store, Order, MenuItem, Setting, User } from '../db/index.js'
import { emitOrderNew } from '../../socket/orderEvents.js'
import { PushSender } from '../../adapters/push-sender/fcm.adapter.js'

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

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

export async function guestOrderRoutes(app: FastifyInstance) {
  // ── POST /guest/orders — Khách vãng lai đặt hàng (không cần auth) ─────────
  app.post<{ Body: any }>('/guest/orders', async (req, reply) => {
    // Kiểm tra cài đặt cho phép khách vãng lai
    const setting = await Setting.findOne({ key: 'guest_orders_enabled' }).lean()
    if (setting?.value === false) {
      return reply.code(403).send({ error: 'Tính năng đặt hàng khách vãng lai hiện không khả dụng' })
    }

    const body = req.body as Record<string, any>

    // ── Validate thông tin khách ──────────────────────────────────────────────
    const guestName  = body.guestInfo?.name?.trim()
    const guestPhone = body.guestInfo?.phone?.trim()

    if (!guestName) return reply.code(400).send({ error: 'Cần tên người đặt' })
    if (!guestPhone) return reply.code(400).send({ error: 'Cần số điện thoại người đặt' })
    if (!/^0[0-9]{9}$/.test(guestPhone)) {
      return reply.code(400).send({ error: 'Số điện thoại không hợp lệ (phải bắt đầu bằng 0, 10 chữ số)' })
    }

    // ── Validate đơn hàng cơ bản ─────────────────────────────────────────────
    if (!mongoose.isValidObjectId(body.storeId)) {
      return reply.code(400).send({ error: 'storeId không hợp lệ' })
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return reply.code(400).send({ error: 'Đơn hàng cần ít nhất 1 món' })
    }

    const deliveryMethod: string = body.deliveryMethod ?? 'store_delivery'
    if (!['store_delivery', 'self_pickup'].includes(deliveryMethod)) {
      return reply.code(400).send({ error: 'deliveryMethod không hợp lệ' })
    }

    // Khách vãng lai bắt buộc chuyển khoản 100%
    const paymentMethod = 'bank_transfer'

    // ── Fetch quán ────────────────────────────────────────────────────────────
    const store = await Store.findOne({ _id: body.storeId, isDeleted: { $ne: true } })
    if (!store) return reply.code(404).send({ error: 'Không tìm thấy quán' })

    // Kiểm tra quán có chấp nhận CK không
    if (!store.paymentMethods?.bankTransfer && !store.bankAccount?.number) {
      return reply.code(400).send({ error: 'Quán này chưa hỗ trợ chuyển khoản' })
    }

    // ── Fetch món & build snapshots ──────────────────────────────────────────
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
      if (!menu) return reply.code(400).send({ error: 'Món không tồn tại hoặc không thuộc quán này' })
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

    // ── Tọa độ quán ───────────────────────────────────────────────────────────
    const storeCoords = store.address?.location?.coordinates as [number, number] | undefined
    const storeLng = storeCoords?.[0] ?? 0
    const storeLat = storeCoords?.[1] ?? 0

    // ── Tọa độ giao hàng & khoảng cách ───────────────────────────────────────
    const isSelfPickup = deliveryMethod === 'self_pickup'

    let deliveryLng = storeLng
    let deliveryLat = storeLat
    let deliveryText: string = body.deliveryAddress?.text?.trim() ?? ''

    if (!isSelfPickup) {
      const clientCoords = body.deliveryAddress?.location?.coordinates as [number, number] | undefined
      if (clientCoords && clientCoords.length >= 2) {
        deliveryLng = Number(clientCoords[0])
        deliveryLat = Number(clientCoords[1])
      }
      if (!deliveryText) return reply.code(400).send({ error: 'Cần địa chỉ giao hàng' })
    } else {
      deliveryText = deliveryText || store.address?.text || 'Đến lấy tại quán'
    }

    const rawDistKm = haversineKm(storeLat, storeLng, deliveryLat, deliveryLng)
    const distanceKm = isSelfPickup ? 0 : parseFloat(rawDistKm.toFixed(2))

    if (distanceKm > 25) {
      return reply.code(400).send({ error: `Khoảng cách giao hàng ${distanceKm.toFixed(1)} km vượt quá giới hạn 25 km` })
    }

    // ── Phí ship ─────────────────────────────────────────────────────────────
    const formula = store.shipFeeFormula ?? { a: 12000, b: 5000, c: 0 }
    const rawFee  = isSelfPickup ? 0 : (formula.a + formula.b * distanceKm) * (1 + formula.c / 100)
    const shipFee = isSelfPickup ? 0 : Math.round(rawFee / 1000) * 1000

    // ── Bank snapshot ─────────────────────────────────────────────────────────
    const storeBankSnapshot = store.bankAccount?.number
      ? {
          number: store.bankAccount.number,
          bank:   store.bankAccount.bank   ?? '',
          holder: store.bankAccount.holder ?? '',
        }
      : null

    if (!storeBankSnapshot) {
      return reply.code(400).send({ error: 'Quán chưa cài đặt tài khoản ngân hàng để nhận CK' })
    }

    // ── Tạo mã đơn & trackingToken ────────────────────────────────────────────
    let code = genCode()
    while (await Order.exists({ code })) { code = genCode() }
    const trackingToken = crypto.randomBytes(16).toString('hex') // 32 hex chars

    // ── guestInfo ─────────────────────────────────────────────────────────────
    const guestInfo: Record<string, any> = {
      name:  guestName,
      phone: guestPhone,
    }
    if (body.guestInfo?.email?.trim()) {
      guestInfo.email = body.guestInfo.email.trim().toLowerCase()
    }
    const bank = body.guestInfo?.bankAccountForRefund
    if (bank?.number?.trim() && bank?.bank?.trim() && bank?.holder?.trim()) {
      guestInfo.bankAccountForRefund = {
        number: bank.number.trim(),
        bank:   bank.bank.trim(),
        holder: bank.holder.trim(),
      }
    }

    // ── Tạo đơn hàng ─────────────────────────────────────────────────────────
    const order = new Order({
      code,
      trackingToken,
      customerId:  null,
      guestInfo,
      storeId:     store._id,
      receiver: {
        name:           guestName,
        phone:          guestPhone,
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
      paymentStatus:      'unpaid',
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
      mainStatus:   'awaiting_payment',
      isPreOrder:   false,
      statusHistory: [{ status: 'awaiting_payment', at: new Date(), by: 'guest' }],
    })

    try {
      await order.save()
    } catch (err: any) {
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

    const webUrl = process.env.WEB_URL ?? 'https://vifosa.vercel.app'
    const trackingLink = `${webUrl}/track/${order.code}?t=${order.trackingToken}`

    return reply.code(201).send({
      order: {
        _id:              order._id,
        code:             order.code,
        trackingToken:    order.trackingToken,
        storeName:        store.name,
        storeBankSnapshot: order.storeBankSnapshot,
        storeVipTier:     (store.vipTier as string) ?? 'none',
        totalAmount:      order.totalAmount,
        itemsTotal:       order.itemsTotal,
        shipFee:          order.shipFee,
        paymentMethod:    order.paymentMethod,
        mainStatus:       order.mainStatus,
        createdAt:        order.createdAt,
      },
      trackingLink,
    })
  })
}
