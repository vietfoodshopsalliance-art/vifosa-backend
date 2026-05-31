import { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, MenuCategory, MenuItem, Like, nextSku } from '../db/index.js'
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

/**
 * Tìm danh mục theo tên trong 1 quán; tạo mới nếu chưa có. Trả về _id danh mục.
 * Dùng khi đồng bộ món sang quán anh em — categoryId khớp theo tên.
 */
async function findOrCreateCategoryByName(
  storeId: mongoose.Types.ObjectId,
  name: string
): Promise<mongoose.Types.ObjectId> {
  const trimmed = name.trim()
  const existing = await MenuCategory.findOne({
    storeId,
    name: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  })
  if (existing) return existing._id as mongoose.Types.ObjectId
  const maxOrder = await MenuCategory.findOne({ storeId }).sort({ displayOrder: -1 })
  const cat = await MenuCategory.create({
    storeId,
    name: trimmed,
    displayOrder: (maxOrder?.displayOrder ?? -1) + 1,
  })
  return cat._id as mongoose.Types.ObjectId
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
      const { syncToSiblings, ...body } = req.body as Record<string, any>

      // ── Tạo món thường (không đồng bộ) ──────────────────────────────────────
      if (!syncToSiblings) {
        const item = await MenuItem.create({ ...body, storeId: store._id, ownerId: store.ownerId })
        return reply.code(201).send(item)
      }

      // ── Tạo món ĐỒNG BỘ trên tất cả cửa hàng cùng chủ ──────────────────────
      const siblings = await Store.find({ ownerId: store.ownerId, isDeleted: { $ne: true } })
      if (siblings.length === 0) {
        return reply.code(400).send({ error: 'Không tìm thấy cửa hàng nào của chủ quán' })
      }

      let sku: string
      try {
        sku = await nextSku(store.ownerId)
      } catch (e: any) {
        return reply.code(400).send({ error: e?.message ?? 'Không cấp được SKU' })
      }
      const syncGroupId = new mongoose.Types.ObjectId()
      const categoryName =
        typeof body.categoryName === 'string' && body.categoryName.trim()
          ? (body.categoryName as string)
          : null

      const created: any[] = []
      for (const sib of siblings) {
        // categoryId: lần đầu danh mục giống nhau → khớp theo tên, tạo nếu thiếu
        let categoryId: mongoose.Types.ObjectId | null = null
        if (categoryName) {
          categoryId = await findOrCreateCategoryByName(sib._id as mongoose.Types.ObjectId, categoryName)
        }
        const doc = await MenuItem.create({
          storeId: sib._id,
          ownerId: store.ownerId,
          categoryId,
          name: body.name,
          description: body.description ?? '',
          price: body.price,
          images: body.images ?? [],
          stock: 0, // tạo lần đầu tồn kho = 0 → hook tự chuyển 'paused' (hết hàng)
          sku,
          syncGroupId,
          isSynced: true,
        })
        created.push(doc)
      }

      // Trả về bản tạo tại đúng cửa hàng đang thao tác
      const own = created.find((d) => d.storeId.toString() === (store._id as any).toString())
      return reply.code(201).send({ item: own ?? created[0], sku, siblingCount: created.length })
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

      const current = await MenuItem.findOne({
        _id: req.params.iid,
        storeId: store._id,
        isDeleted: false,
      })
      if (!current) return reply.code(404).send({ error: 'Không tìm thấy món' })

      // propagate: danh sách field người dùng đồng ý cập nhật sang cửa hàng khác
      const { propagate, ...body } = req.body as Record<string, any>

      // Món đồng bộ không được bán vô hạn
      if (current.isSynced && (body.stock === null || body.stock === undefined && 'stock' in body)) {
        delete body.stock // bỏ qua việc set null; giữ tồn kho hiện tại
      }

      const item = await MenuItem.findOneAndUpdate(
        { _id: req.params.iid, storeId: store._id, isDeleted: false },
        { $set: body },
        { new: true, runValidators: true }
      )
      if (!item) return reply.code(404).send({ error: 'Không tìm thấy món' })

      // ── Lan truyền sang các bản đồng bộ cùng syncGroupId ───────────────────
      let siblingCount = 0
      if (item.isSynced && item.syncGroupId) {
        // Field LUÔN đồng bộ: tên gọi & hình ảnh
        const autoFields: Record<string, any> = {}
        if ('name' in body) autoFields.name = item.name
        if ('images' in body) autoFields.images = item.images

        // Field CHỈ đồng bộ khi user xác nhận: giá, mô tả
        const optFields: Record<string, any> = {}
        const propArr: string[] = Array.isArray(propagate) ? propagate : []
        if (propArr.includes('price') && 'price' in body) optFields.price = item.price
        if (propArr.includes('description') && 'description' in body)
          optFields.description = item.description

        const flatUpdate = { ...autoFields, ...optFields }

        // categoryId: đồng bộ theo TÊN danh mục (find-or-create ở mỗi quán)
        const propagateCategory = propArr.includes('categoryId') && 'categoryId' in body
        let categoryName: string | null = null
        if (propagateCategory && item.categoryId) {
          const cat = await MenuCategory.findById(item.categoryId)
          categoryName = cat?.name ?? null
        }

        const others = await MenuItem.find({
          syncGroupId: item.syncGroupId,
          _id: { $ne: item._id },
          isDeleted: false,
        })
        for (const other of others) {
          const upd: Record<string, any> = { ...flatUpdate }
          if (propagateCategory) {
            upd.categoryId = categoryName
              ? await findOrCreateCategoryByName(other.storeId as mongoose.Types.ObjectId, categoryName)
              : null
          }
          if (Object.keys(upd).length > 0) {
            await MenuItem.updateOne({ _id: other._id }, { $set: upd }, { runValidators: true })
            siblingCount++
          }
        }
      }

      return reply.send({ ...(item.toObject() as any), siblingCount })
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
