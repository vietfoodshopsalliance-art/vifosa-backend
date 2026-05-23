import { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, MenuCategory, MenuItem, Like } from '../db/index.js'
import { verifyAccessToken } from '../../utils/jwt.js'
import mongoose from 'mongoose'

async function assertStoreOwner(storeId: string, userId: string, reply: any) {
  if (!mongoose.isValidObjectId(storeId)) {
    reply.code(400).send({ error: 'storeId không hợp lệ' })
    return null
  }
  const store = await Store.findOne({ _id: storeId, isDeleted: { $ne: true } })
  if (!store) { reply.code(404).send({ error: 'Không tìm thấy quán' }); return null }
  if (store.ownerId.toString() !== userId) {
    reply.code(403).send({ error: 'Bạn không phải chủ quán này' }); return null
  }
  return store
}

export default async function menuRoutes(app: FastifyInstance) {
  // ── GET /:storeId/menu (public) ───────────────────────────────────────────
  app.get<{ Params: { storeId: string } }>(
    '/:storeId/menu',
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.storeId)) {
        return reply.code(400).send({ error: 'storeId không hợp lệ' })
      }
      const storeObjId = new mongoose.Types.ObjectId(req.params.storeId)
      const [categories, items] = await Promise.all([
        MenuCategory.find({ storeId: storeObjId }).sort({ displayOrder: 1 }),
        MenuItem.find({ storeId: storeObjId, isDeleted: false, status: { $ne: 'closed' } })
          .sort({ categoryId: 1, createdAt: 1 }),
      ])

      // Gắn likeId nếu user đã đăng nhập
      let userId: string | null = null
      try {
        const authHeader = req.headers.authorization
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (req as any).cookies?.accessToken
        if (token) userId = verifyAccessToken(token).sub
      } catch { /* guest — bỏ qua */ }

      if (userId) {
        const itemIds = items.map(i => i._id)
        const likes = await Like.find({ userId, targetType: 'item', targetId: { $in: itemIds } }).lean()
        const likeMap = new Map(likes.map((l: any) => [l.targetId.toString(), l._id.toString()]))
        const itemsWithLikes = items.map(item => ({
          ...(item.toObject() as any),
          likeId: likeMap.get(item._id.toString()) ?? null,
        }))
        return reply.send({ categories, items: itemsWithLikes })
      }

      return reply.send({ categories, items })
    }
  )

  // ── GET /:storeId/menu/all (owner — includes closed/deleted) ─────────────
  app.get<{ Params: { storeId: string } }>(
    '/:storeId/menu/all',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      const storeObjId = new mongoose.Types.ObjectId(req.params.storeId)
      const [categories, items] = await Promise.all([
        MenuCategory.find({ storeId: storeObjId }).sort({ displayOrder: 1 }),
        MenuItem.find({ storeId: storeObjId, isDeleted: false }).sort({ categoryId: 1, displayOrder: 1, createdAt: 1 }),
      ])
      return reply.send({ categories, items })
    }
  )

  // ── POST /:storeId/menu/categories ───────────────────────────────────────
  app.post<{ Params: { storeId: string }; Body: { name: string; displayOrder?: number } }>(
    '/:storeId/menu/categories',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      const maxOrder = await MenuCategory.findOne({ storeId: store._id }).sort({ displayOrder: -1 })
      const cat = await MenuCategory.create({
        storeId: store._id,
        name: req.body.name,
        displayOrder: req.body.displayOrder ?? ((maxOrder?.displayOrder ?? -1) + 1),
      })
      return reply.code(201).send(cat)
    }
  )

  // ── PATCH /:storeId/menu/categories/reorder ───────────────────────────────
  app.patch<{ Params: { storeId: string }; Body: { order: { id: string; displayOrder: number }[] } }>(
    '/:storeId/menu/categories/reorder',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      await Promise.all(
        req.body.order.map(({ id, displayOrder }) =>
          MenuCategory.updateOne({ _id: id, storeId: store._id }, { displayOrder })
        )
      )
      return reply.send({ ok: true })
    }
  )

  // ── PATCH /:storeId/menu/categories/:cid ─────────────────────────────────
  app.patch<{ Params: { storeId: string; cid: string }; Body: any }>(
    '/:storeId/menu/categories/:cid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      const cat = await MenuCategory.findOneAndUpdate(
        { _id: req.params.cid, storeId: store._id },
        { $set: req.body },
        { new: true, runValidators: true }
      )
      if (!cat) return reply.code(404).send({ error: 'Không tìm thấy danh mục' })
      return reply.send(cat)
    }
  )

  // ── DELETE /:storeId/menu/categories/:cid ────────────────────────────────
  app.delete<{ Params: { storeId: string; cid: string } }>(
    '/:storeId/menu/categories/:cid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      const cat = await MenuCategory.findOneAndDelete({ _id: req.params.cid, storeId: store._id })
      if (!cat) return reply.code(404).send({ error: 'Không tìm thấy danh mục' })
      // Unset categoryId của các món thuộc danh mục này
      await MenuItem.updateMany({ storeId: store._id, categoryId: cat._id }, { $set: { categoryId: null } })
      return reply.send({ ok: true })
    }
  )

  // ── POST /:storeId/menu/items ─────────────────────────────────────────────
  app.post<{ Params: { storeId: string }; Body: any }>(
    '/:storeId/menu/items',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      const body = req.body as Record<string, unknown>
      const item = await MenuItem.create({ ...body, storeId: store._id })
      return reply.code(201).send(item)
    }
  )

  // ── PATCH /:storeId/menu/items/reorder ───────────────────────────────────
  app.patch<{ Params: { storeId: string }; Body: { order: { id: string; displayOrder: number }[] } }>(
    '/:storeId/menu/items/reorder',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      await Promise.all(
        req.body.order.map(({ id, displayOrder }) =>
          MenuItem.updateOne({ _id: id, storeId: store._id }, { displayOrder })
        )
      )
      return reply.send({ ok: true })
    }
  )

  // ── PATCH /:storeId/menu/items/:iid ──────────────────────────────────────
  app.patch<{ Params: { storeId: string; iid: string }; Body: any }>(
    '/:storeId/menu/items/:iid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      const item = await MenuItem.findOneAndUpdate(
        { _id: req.params.iid, storeId: store._id, isDeleted: false },
        { $set: req.body },
        { new: true, runValidators: true }
      )
      if (!item) return reply.code(404).send({ error: 'Không tìm thấy món' })
      return reply.send(item)
    }
  )

  // ── DELETE /:storeId/menu/items/:iid (soft delete) ───────────────────────
  app.delete<{ Params: { storeId: string; iid: string } }>(
    '/:storeId/menu/items/:iid',
    { preHandler: requireAuth },
    async (req, reply) => {
      const store = await assertStoreOwner(req.params.storeId, req.user!.userId, reply)
      if (!store) return
      const item = await MenuItem.findOneAndUpdate(
        { _id: req.params.iid, storeId: store._id, isDeleted: false },
        { $set: { isDeleted: true } },
        { new: true }
      )
      if (!item) return reply.code(404).send({ error: 'Không tìm thấy món' })
      return reply.send({ ok: true })
    }
  )
}
