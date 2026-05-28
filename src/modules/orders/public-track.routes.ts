import { FastifyInstance } from 'fastify'
import { Order, Store } from '../db/index.js'
import type { MainStatus } from '../db/orders.model.js'

// Map internal status → trạng thái đơn giản cho khách vãng lai (GuestTrackingScreen)
const STATUS_MAP: Partial<Record<MainStatus, string>> = {
  awaiting_payment:    'pending',
  awaiting_store_open: 'pending',
  pending_store:       'pending',
  preparing:           'accepted',
  delivering:          'delivering',
  delivered:           'delivered',
  completed:           'received',
  cancelled:           'cancelled',
}

export async function publicTrackRoutes(app: FastifyInstance) {
  // ── GET /track — tra cứu đơn công khai ────────────────────────────────────
  // Phương án A: ?code=AB251107-456&t=<token32>
  // Phương án B: ?code=AB251107-456&phone=0912345678
  app.get<{
    Querystring: { code?: string; t?: string; phone?: string }
  }>('/track', async (req, reply) => {
    const { code, t: token, phone } = req.query

    if (!code?.trim()) {
      return reply.code(400).send({ error: 'Cần mã đơn hàng (code)' })
    }

    const order = await Order.findOne({ code: code.trim().toUpperCase() })
    if (!order) {
      return reply.code(404).send({ error: 'Không tìm thấy đơn hàng' })
    }

    // ── Xác thực: token (A) hoặc SĐT (B) ────────────────────────────────────
    if (token) {
      if (order.trackingToken !== token.trim()) {
        return reply.code(403).send({ error: 'Token không hợp lệ' })
      }
    } else if (phone) {
      const ph = phone.trim()
      const matchGuest    = order.guestInfo?.phone === ph
      const matchReceiver = order.receiver.phone   === ph
      if (!matchGuest && !matchReceiver) {
        return reply.code(403).send({ error: 'Số điện thoại không khớp với đơn hàng này' })
      }
    } else {
      return reply.code(400).send({ error: 'Cần token (?t=) hoặc số điện thoại (?phone=) để tra cứu' })
    }

    // ── Lấy tên quán ─────────────────────────────────────────────────────────
    const storeDoc = await Store.findById(order.storeId).select('name vipTier').lean()

    const guestStatus = STATUS_MAP[order.mainStatus] ?? 'pending'

    return reply.send({
      order: {
        code:             order.code,
        status:           guestStatus,
        mainStatus:       order.mainStatus,
        storeName:        storeDoc?.name ?? '',
        storeVipTier:     (storeDoc as any)?.vipTier ?? 'none',
        deliveryAddress:  order.deliveryAddress?.text ?? '',
        items: order.items.map((i) => ({
          name:     i.nameSnapshot,
          quantity: i.qty,
          price:    i.priceSnapshot,
        })),
        totalAmount:      order.totalAmount,
        shipFee:          order.shipFee,
        paymentMethod:    order.paymentMethod,
        paymentStatus:    order.paymentStatus,
        bankTransferReceiptUrl: order.bankTransferReceiptUrl ?? null,
        storeBankSnapshot: order.storeBankSnapshot,
        createdAt:        order.createdAt,
      },
    })
  })

  // ── POST /track/upload-receipt — khách vãng lai upload biên lai ───────────
  app.post<{
    Querystring: { code?: string; t?: string }
    Body: { receiptUrl?: string }
  }>('/track/upload-receipt', async (req, reply) => {
    const { code, t: token } = req.query
    if (!code?.trim() || !token?.trim()) {
      return reply.code(400).send({ error: 'Cần code và token' })
    }

    const order = await Order.findOne({ code: code.trim().toUpperCase() })
    if (!order) return reply.code(404).send({ error: 'Không tìm thấy đơn hàng' })
    if (order.trackingToken !== token.trim()) {
      return reply.code(403).send({ error: 'Token không hợp lệ' })
    }

    const url = req.body?.receiptUrl?.trim()
    if (!url) return reply.code(400).send({ error: 'receiptUrl là bắt buộc' })

    order.bankTransferReceiptUrl = url
    await order.save()

    return reply.send({ success: true })
  })
}
