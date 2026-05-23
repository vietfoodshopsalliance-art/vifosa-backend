import { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, Order, Review } from '../db/index.js'
import mongoose from 'mongoose'

export async function reviewRoutes(app: FastifyInstance) {
  // ── GET /stores/:storeId/reviews (public) ─────────────────────────────────
  app.get<{ Params: { storeId: string }; Querystring: { page?: string; limit?: string; rating?: string } }>(
    '/stores/:storeId/reviews',
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.storeId)) {
        return reply.code(400).send({ error: 'storeId không hợp lệ' })
      }
      const page  = Math.max(1, parseInt(req.query.page  ?? '1'))
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20')))
      const storeObjId = new mongoose.Types.ObjectId(req.params.storeId)
      const filter: any = { toEntityId: storeObjId, toEntityType: 'store', isHiddenByAdmin: false }
      if (req.query.rating) filter.stars = parseInt(req.query.rating)

      const [reviews, total] = await Promise.all([
        Review.find(filter)
          .populate('fromUserId', 'nickname avatarUrl')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Review.countDocuments(filter),
      ])

      // Flatten populated fromUserId → top-level nickname/avatar
      const formatted = reviews.map(r => {
        const rv = r.toObject() as any
        const user = rv.fromUserId
        return {
          ...rv,
          _id: rv._id.toString(),
          orderId: rv.orderId.toString(),
          toEntityId: rv.toEntityId.toString(),
          fromUserId: rv.isAnonymous ? null : (user?._id?.toString() ?? null),
          nickname: rv.isAnonymous ? null : (user?.nickname ?? null),
          avatar: rv.isAnonymous ? null : (user?.avatarUrl ?? null),
        }
      })

      return reply.send({ reviews: formatted, total, page, limit })
    }
  )

  // ── POST /orders/:orderId/review ──────────────────────────────────────────
  app.post<{
    Params: { orderId: string }
    Body: { stars: number; comment?: string; images?: string[]; isAnonymous?: boolean }
  }>(
    '/orders/:orderId/review',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.orderId)) {
        return reply.code(400).send({ error: 'orderId không hợp lệ' })
      }
      const order = await Order.findById(req.params.orderId)
      if (!order) return reply.code(404).send({ error: 'Không tìm thấy đơn hàng' })
      if (order.customerId?.toString() !== req.user!.userId) {
        return reply.code(403).send({ error: 'Chỉ người đặt mới được đánh giá' })
      }
      if (!(['completed', 'delivered'] as string[]).includes(order.mainStatus)) {
        return reply.code(409).send({ error: 'Chỉ đánh giá được đơn đã hoàn thành' })
      }
      const existing = await Review.findOne({ orderId: order._id })
      if (existing) return reply.code(409).send({ error: 'Đơn hàng này đã được đánh giá' })

      const review = await Review.create({
        orderId: order._id,
        fromUserId: req.user!.userId,
        toEntityType: 'store',
        toEntityId: order.storeId,
        stars: req.body.stars as 1 | 2 | 3 | 4 | 5,
        comment: req.body.comment ?? '',
        images: req.body.images ?? [],
        isAnonymous: req.body.isAnonymous ?? false,
      })

      // Cập nhật stats.avgRating của store
      const agg = await Review.aggregate([
        { $match: { toEntityId: order.storeId, toEntityType: 'store', isHiddenByAdmin: false } },
        { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
      ])
      if (agg[0]) {
        await Store.updateOne(
          { _id: order.storeId },
          { $set: { 'stats.avgRating': Math.round(agg[0].avg * 10) / 10, 'stats.totalReviews': agg[0].count } }
        )
      }

      return reply.code(201).send(review)
    }
  )

  // ── PATCH /stores/:storeId/reviews/:reviewId/reply ────────────────────────
  app.patch<{
    Params: { storeId: string; reviewId: string }
    Body: { text: string }
  }>(
    '/stores/:storeId/reviews/:reviewId/reply',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.storeId) || !mongoose.isValidObjectId(req.params.reviewId)) {
        return reply.code(400).send({ error: 'ID không hợp lệ' })
      }
      const store = await Store.findOne({ _id: req.params.storeId, isDeleted: false })
      if (!store) return reply.code(404).send({ error: 'Không tìm thấy quán' })
      if (store.ownerId.toString() !== req.user!.userId) {
        return reply.code(403).send({ error: 'Bạn không phải chủ quán này' })
      }

      const storeObjId = new mongoose.Types.ObjectId(req.params.storeId)
      const review = await Review.findOne({
        _id: req.params.reviewId,
        toEntityId: storeObjId,
        toEntityType: 'store',
      })
      if (!review) return reply.code(404).send({ error: 'Không tìm thấy đánh giá' })

      const now = new Date()
      review.reply = review.reply
        ? { text: req.body.text, at: review.reply.at, editedAt: now }
        : { text: req.body.text, at: now }

      await review.save()
      return reply.send(review)
    }
  )
}
