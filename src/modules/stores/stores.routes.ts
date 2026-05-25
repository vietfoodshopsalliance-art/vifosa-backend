import { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store } from '../db/index.js'
import { Order } from '../db/index.js'
import { Review } from '../db/index.js'
import { User } from '../db/index.js'
import mongoose from 'mongoose'

export async function storesRoutes(app: FastifyInstance) {
  // ── Helpers ──────────────────────────────────────────────────────────────

  async function assertOwner(storeId: string, userId: string, reply: any) {
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
      reply.log.warn({ storeId, storeOwnerId: store.ownerId.toString(), requestUserId: userId }, '[assertOwner] 403 owner mismatch')
      reply.code(403).send({ error: 'Bạn không phải chủ quán này' })
      return null
    }
    return store
  }

  // ── GET /me/stores ────────────────────────────────────────────────────────
  app.get('/me/stores', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.user!.userId
    const stores = await Store.find({ ownerId: userId, isDeleted: { $ne: true } }).sort({ createdAt: -1 })
    return reply.send(stores)
  })

  // ── POST /me/stores ───────────────────────────────────────────────────────
  app.post<{ Body: any }>('/me/stores', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.user!.userId
    const body = req.body as Record<string, any>

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length < 2) {
      return reply.code(400).send({ error: 'Tên quán tối thiểu 2 ký tự' })
    }
    if (!body.address?.text || !body.address?.location?.coordinates) {
      return reply.code(400).send({ error: 'Địa chỉ và toạ độ là bắt buộc' })
    }

    const store = new Store({
      ownerId: userId,
      name: body.name.trim(),
      description: body.description ?? '',
      phone: body.phone ?? '',
      address: body.address,
      openingHours: body.openingHours,
      bankAccount: body.bankAccount ?? null,
      paymentMethods: body.paymentMethods,
      shipFeeFormula: body.shipFeeFormula,
      autoCancelMinutes: body.autoCancelMinutes ?? 15,
      autoConfirmMinutes: body.autoConfirmMinutes ?? 0,
    })

    await store.save()
    await User.findByIdAndUpdate(userId, { $addToSet: { roles: 'store_owner' } })
    return reply.code(201).send(store)
  })

  // ── GET /me/stores/:storeId ───────────────────────────────────────────────
  app.get<{ Params: { storeId: string } }>(
    '/me/stores/:storeId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      return reply.send(store)
    }
  )

  // ── PATCH /me/stores/:storeId ─────────────────────────────────────────────
  app.patch<{ Params: { storeId: string }; Body: any }>(
    '/me/stores/:storeId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return

      const allowed = [
        'name', 'description', 'phone',
        'coverImage', 'avatarImage',
        'address', 'openingHours', 'bankAccount', 'paymentMethods',
        'shipFeeFormula', 'autoConfirmMinutes', 'autoCancelMinutes',
      ]
      const body = req.body as Record<string, unknown>
      for (const key of allowed) {
        if (key in body) (store as any)[key] = body[key]
      }
      await store.save()
      return reply.send(store)
    }
  )

  // ── PATCH /me/stores/:storeId/open ───────────────────────────────────────
  app.patch<{ Params: { storeId: string }; Body: { open?: boolean } }>(
    '/me/stores/:storeId/open',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return

      store.isOpen = typeof req.body.open === 'boolean'
        ? req.body.open
        : !store.isOpen

      await store.save()
      return reply.send({ isOpen: store.isOpen })
    }
  )

  // ── PATCH /me/stores/:storeId/emergency-close ─────────────────────────────
  app.patch<{ Params: { storeId: string }; Body: { close?: boolean } }>(
    '/me/stores/:storeId/emergency-close',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return

      // toggle nếu không truyền, hoặc set theo giá trị truyền vào
      store.emergencyClosed = typeof req.body.close === 'boolean'
        ? req.body.close
        : !store.emergencyClosed

      await store.save()
      return reply.send({ emergencyClosed: store.emergencyClosed })
    }
  )

  // ── GET /me/stores/:storeId/stats ─────────────────────────────────────────
  app.get<{ Params: { storeId: string } }>(
    '/me/stores/:storeId/stats',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return

      const storeObjId = new mongoose.Types.ObjectId(req.params.storeId)
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())

      const [revenueAgg, pendingCount, preparingCount, todayOrders, reviewAgg] = await Promise.all([
        // Doanh thu tháng này (completed orders)
        Order.aggregate([
          {
            $match: {
              storeId: storeObjId,
              mainStatus: 'completed',
              updatedAt: { $gte: startOfMonth },
            },
          },
          { $group: { _id: null, total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
        ]),
        // Đơn chờ xác nhận
        Order.countDocuments({ storeId: storeObjId, mainStatus: 'pending_store' }),
        // Đơn đang làm
        Order.countDocuments({ storeId: storeObjId, mainStatus: { $in: ['preparing', 'delivering'] } }),
        // Đơn hôm nay
        Order.countDocuments({ storeId: storeObjId, createdAt: { $gte: startOfToday } }),
        // Rating trung bình
        Review.aggregate([
          { $match: { toEntityId: storeObjId, toEntityType: 'store', isHiddenByAdmin: false } },
          { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
        ]),
      ])

      return reply.send({
        revenueThisMonth: revenueAgg[0]?.total ?? 0,
        completedOrdersThisMonth: revenueAgg[0]?.count ?? 0,
        pendingOrders: pendingCount,
        activeOrders: preparingCount,
        ordersToday: todayOrders,
        avgRating: reviewAgg[0]?.avg ? Math.round(reviewAgg[0].avg * 10) / 10 : 0,
        totalReviews: reviewAgg[0]?.count ?? 0,
      })
    }
  )

  // ── DELETE /me/stores/:storeId — soft delete ─────────────────────────────
  app.delete<{ Params: { storeId: string } }>(
    '/me/stores/:storeId',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return

      store.isDeleted = true
      store.deletedAt = new Date()
      store.isOpen = false
      store.emergencyClosed = true
      await store.save()

      return reply.send({ ok: true })
    }
  )

  // ── GET /stores/:storeId (public) ─────────────────────────────────────────
  app.get<{ Params: { storeId: string } }>(
    '/stores/:storeId',
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.storeId)) {
        return reply.code(400).send({ error: 'storeId không hợp lệ' })
      }
      const store = await Store.findOne({ _id: req.params.storeId, isDeleted: { $ne: true }, isSuspended: { $ne: true } })
      if (!store) return reply.code(404).send({ error: 'Không tìm thấy quán' })
      return reply.send(store)
    }
  )
}
