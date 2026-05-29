// backend/src/modules/vip/vip.routes.ts
import { FastifyInstance } from 'fastify'
import mongoose from 'mongoose'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, User, Order } from '../db/index.js'
import { VipPlan } from '../db/vip-plans.model.js'
import { VipSubscription } from '../db/vip-subscriptions.model.js'
import { emitPaymentStatus, emitOrderUpdated } from '../../socket/orderEvents.js'

// sePayOrderCode: VFVIP + 10 ký tự hex ngẫu nhiên → dễ nhận dạng trong nội dung CK
function genOrderCode(): string {
  const rand = Math.random().toString(16).slice(2, 12).toUpperCase()
  return `VFVIP${rand}`
}

async function assertStoreOwner(storeId: string, userId: string, reply: any) {
  if (!mongoose.isValidObjectId(storeId)) {
    reply.code(400).send({ error: 'storeId không hợp lệ' })
    return null
  }
  const store = await Store.findOne({ _id: storeId, isDeleted: { $ne: true } })
  if (!store) {
    reply.code(404).send({ error: 'Không tìm thấy quán' })
    return null
  }
  if (store.ownerId.toString() !== userId) {
    reply.code(403).send({ error: 'Bạn không phải chủ quán này' })
    return null
  }
  return store
}

// Cập nhật store.vipTier và user.vipTier dựa trên tier cao nhất của tất cả quán active
async function refreshOwnerVipTier(ownerId: mongoose.Types.ObjectId) {
  const tierOrder = { none: 0, vip: 1, vvip: 2, vvvip: 3 }
  const now = new Date()
  const activeStores = await Store.find({
    ownerId,
    vipTier: { $ne: 'none' },
    vipExpiresAt: { $gt: now },
    isDeleted: { $ne: true },
  }).select('vipTier')

  let bestTier: 'none' | 'vip' | 'vvip' | 'vvvip' = 'none'
  for (const s of activeStores) {
    const t = s.vipTier as 'none' | 'vip' | 'vvip' | 'vvvip'
    if (tierOrder[t] > tierOrder[bestTier]) bestTier = t
  }
  await User.findByIdAndUpdate(ownerId, { vipTier: bestTier })
}

export async function vipRoutes(app: FastifyInstance) {

  // ── GET /vip/plans ────────────────────────────────────────────────────────
  // Public — danh sách gói VIP đang active
  app.get('/vip/plans', async (_req, reply) => {
    const plans = await VipPlan.find({ isActive: true }).sort({ price: 1 })
    return reply.send(plans)
  })

  // ── POST /me/stores/:storeId/vip/subscribe ────────────────────────────────
  // Tạo subscription pending_payment → trả về thông tin chuyển khoản
  app.post<{ Params: { storeId: string }; Body: { planId: string } }>(
    '/me/stores/:storeId/vip/subscribe',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { storeId } = req.params
      const { planId } = req.body ?? {}
      const userId = req.user!.userId

      if (!planId) return reply.code(400).send({ error: 'planId là bắt buộc' })

      const store = await assertStoreOwner(storeId, userId, reply)
      if (!store) return

      const plan = await VipPlan.findOne({ _id: planId, isActive: true })
      if (!plan) return reply.code(404).send({ error: 'Gói VIP không tồn tại hoặc đã ngừng' })

      // Không tạo thêm nếu đã có subscription pending chưa thanh toán
      const pending = await VipSubscription.findOne({
        storeId: store._id,
        status: 'pending_payment',
      })
      if (pending) {
        return reply.send({
          subscription: pending,
          bankInfo: buildBankInfo(pending.sePayOrderCode),
        })
      }

      const sePayOrderCode = genOrderCode()
      const sub = await VipSubscription.create({
        storeId: store._id,
        ownerId: new mongoose.Types.ObjectId(userId),
        planId: plan._id,
        tier: plan.tier,
        durationDays: plan.durationDays,
        pricePaid: plan.price,
        status: 'pending_payment',
        sePayOrderCode,
      })

      return reply.code(201).send({
        subscription: sub,
        bankInfo: buildBankInfo(sePayOrderCode),
      })
    }
  )

  // ── GET /me/stores/:storeId/vip/subscription ──────────────────────────────
  // Trạng thái subscription mới nhất (active hoặc pending)
  app.get<{ Params: { storeId: string } }>(
    '/me/stores/:storeId/vip/subscription',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return

      const sub = await VipSubscription.findOne({ storeId: store._id })
        .sort({ createdAt: -1 })
        .populate('planId', 'name tier durationDays price benefits')

      return reply.send({ subscription: sub ?? null, store: {
        vipTier: store.vipTier,
        vipExpiresAt: store.vipExpiresAt,
      }})
    }
  )

  // ── POST /webhook/sepay ───────────────────────────────────────────────────
  // Nhận webhook từ Sepay khi giao dịch CK vào TK hệ thống
  app.post<{ Body: Record<string, any> }>(
    '/webhook/sepay',
    async (req, reply) => {
      // Verify token
      const token = process.env.SEPAY_WEBHOOK_TOKEN
      if (token) {
        const authHeader = req.headers['authorization'] ?? ''
        const incoming = Array.isArray(authHeader) ? authHeader[0] : authHeader
        if (incoming !== `Apikey ${token}`) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }
      }

      const body = req.body ?? {}
      req.log.info({ sePayWebhook: body }, '[sepay] webhook received')

      // Chỉ xử lý giao dịch tiền vào
      if (body.transferType !== 'in') {
        return reply.send({ success: true, skipped: 'not_in' })
      }

      const content: string = (body.content ?? body.description ?? '').toString()
      const amount: number = Number(body.transferAmount ?? 0)

      // Tìm sePayOrderCode (format VFVIP + 10 hex chars) trong nội dung CK
      const match = content.match(/VFVIP[0-9A-F]{10}/i)
      if (!match) {
        return reply.send({ success: true, skipped: 'no_order_code' })
      }
      const orderCode = match[0].toUpperCase()

      const sub = await VipSubscription.findOne({ sePayOrderCode: orderCode })
      if (!sub) {
        req.log.warn({ orderCode }, '[sepay] không tìm thấy subscription')
        return reply.send({ success: true, skipped: 'not_found' })
      }

      // Đã xử lý rồi
      if (sub.status === 'active') {
        return reply.send({ success: true, skipped: 'already_active' })
      }

      if (sub.status !== 'pending_payment') {
        return reply.send({ success: true, skipped: `status_${sub.status}` })
      }

      // Kiểm tra số tiền (cho phép thêm tối đa 10k phí chuyển khoản)
      if (amount < sub.pricePaid - 1000) {
        req.log.warn({ orderCode, amount, required: sub.pricePaid }, '[sepay] số tiền không đủ')
        return reply.send({ success: true, skipped: 'insufficient_amount' })
      }

      // Kích hoạt subscription
      const now = new Date()
      const expiresAt = new Date(now.getTime() + sub.durationDays * 24 * 60 * 60 * 1000)

      sub.status = 'active'
      sub.startedAt = now
      sub.expiresAt = expiresAt
      sub.sePayTransactionId = String(body.id ?? body.sepayTransactionId ?? '')
      sub.sePayWebhookPayload = body
      sub.sePayConfirmedAt = now
      await sub.save()

      // Cập nhật store
      await Store.findByIdAndUpdate(sub.storeId, {
        vipTier: sub.tier,
        vipExpiresAt: expiresAt,
      })

      // Cập nhật vipTier của owner dựa trên tier cao nhất
      await refreshOwnerVipTier(sub.ownerId as mongoose.Types.ObjectId)

      req.log.info({ orderCode, storeId: sub.storeId, tier: sub.tier }, '[sepay] subscription activated')
      return reply.send({ success: true, activated: true, orderCode })
    }
  )

  // ── POST /webhook/sepay/order ─────────────────────────────────────────────
  // Nhận webhook Sepay cho đơn hàng của quán VIP — tự động xác nhận thanh toán
  app.post<{ Body: Record<string, any> }>(
    '/webhook/sepay/order',
    async (req, reply) => {
      // Verify token (cùng SEPAY_WEBHOOK_TOKEN)
      const token = process.env.SEPAY_WEBHOOK_TOKEN
      if (token) {
        const authHeader = req.headers['authorization'] ?? ''
        const incoming = Array.isArray(authHeader) ? authHeader[0] : authHeader
        if (incoming !== `Apikey ${token}`) {
          return reply.code(401).send({ error: 'Unauthorized' })
        }
      }

      const body = req.body ?? {}
      req.log.info({ sePayOrderWebhook: body }, '[sepay/order] webhook received')

      // Chỉ xử lý tiền vào
      if (body.transferType !== 'in') {
        return reply.send({ success: true, skipped: 'not_in' })
      }

      const accountNumber: string = (body.accountNumber ?? '').toString().trim()
      const content: string       = (body.content ?? body.description ?? '').toString()
      const amount: number        = Number(body.transferAmount ?? 0)

      if (!accountNumber) {
        return reply.send({ success: true, skipped: 'no_account' })
      }

      // Tìm quán VIP có số TK khớp
      const store = await Store.findOne({
        'bankAccount.number': accountNumber,
        vipTier: { $ne: 'none' },
        isDeleted: { $ne: true },
      })

      if (!store) {
        req.log.info({ accountNumber }, '[sepay/order] không tìm thấy quán VIP')
        return reply.send({ success: true, skipped: 'store_not_found' })
      }

      // Extract order.code từ content — format AB251107-456
      // Dấu gạch ngang có thể bị ngân hàng bỏ khi chuyển liên ngân hàng → dùng -?
      const codeMatch = content.match(/[A-Z]{2}\d{6}-?\d{3}/i)
      if (!codeMatch) {
        req.log.warn({ content, storeId: store._id }, '[sepay/order] không tìm thấy mã đơn trong content')
        return reply.send({ success: true, skipped: 'no_order_code' })
      }
      // Chuẩn hoá về format có dấu gạch ngang: QG260528257 → QG260528-257
      const rawCode = codeMatch[0].toUpperCase()
      const orderCode = rawCode.includes('-')
        ? rawCode                                           // đã có dấu - → giữ nguyên
        : rawCode.slice(0, 8) + '-' + rawCode.slice(8)     // ngân hàng bỏ dấu - → chèn lại

      // Tìm đơn hàng
      const order = await Order.findOne({
        code: orderCode,
        storeId: store._id,
        paymentStatus: { $nin: ['paid_full', 'cod_collected'] },
      })

      if (!order) {
        req.log.warn({ orderCode, storeId: store._id }, '[sepay/order] không tìm thấy đơn hoặc đã thanh toán')
        return reply.send({ success: true, skipped: 'order_not_found' })
      }

      // Kiểm tra số tiền — fifty_fifty chỉ cần nửa trước
      const required = order.paymentMethod === 'fifty_fifty'
        ? Math.ceil(order.totalAmount / 2)
        : order.totalAmount

      if (amount < required - 1000) {
        req.log.warn({ orderCode, amount, required }, '[sepay/order] số tiền không đủ')
        return reply.send({ success: true, skipped: 'insufficient_amount' })
      }

      // Cập nhật trạng thái thanh toán
      order.paymentStatus = 'paid_full'
      order.paidAmount    = amount
      await order.save()

      // Notify realtime
      emitPaymentStatus(order._id.toString(), 'paid_full')
      emitOrderUpdated(store._id.toString(), { type: 'payment_reconciled', orderId: order._id.toString() })

      req.log.info({ orderCode, storeId: store._id, amount }, '[sepay/order] payment confirmed')
      return reply.send({ success: true, confirmed: true, orderCode })
    }
  )
}

function buildBankInfo(sePayOrderCode: string) {
  // VietinBank/SePay yêu cầu nội dung CK bắt đầu bằng SEVQR
  const transferContent = `SEVQR ${sePayOrderCode}`
  return {
    bankNumber: process.env.VIP_BANK_NUMBER ?? '',
    bankName: process.env.VIP_BANK_NAME ?? '',
    bankHolder: process.env.VIP_BANK_HOLDER ?? '',
    content: transferContent,
    note: `Nội dung chuyển khoản phải là chính xác: ${transferContent}`,
  }
}
