import { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { Store, Order, Review } from '../db/index.js'
import mongoose from 'mongoose'

const MS_24H = 24 * 60 * 60 * 1000
const MS_30D = 30 * 24 * 60 * 60 * 1000

// Thời điểm author (fromUserId) còn được sửa/xóa review:
// 24h kể từ lần cuối phía reply sửa (reply.editedAt → reply.at → review.createdAt)
function authorEditDeadline(review: any): Date {
  const base = review.reply?.editedAt ?? review.reply?.at ?? review.createdAt
  return new Date(base.getTime() + MS_24H)
}

// Thời điểm phía reply còn được sửa reply:
// 24h kể từ lần cuối review được sửa (review.editedAt → review.createdAt)
function replyEditDeadline(review: any): Date {
  const base = review.editedAt ?? review.createdAt
  return new Date(base.getTime() + MS_24H)
}

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
          .populate('orderId', 'code')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        Review.countDocuments(filter),
      ])

      const formatted = reviews.map(r => {
        const rv = r.toObject() as any
        const user = rv.fromUserId
        const orderObj = rv.orderId
        return {
          ...rv,
          _id: rv._id.toString(),
          orderId: orderObj?._id?.toString() ?? orderObj?.toString() ?? null,
          orderCode: orderObj?.code ?? null,
          toEntityId: rv.toEntityId.toString(),
          fromUserId: rv.isAnonymous ? null : (user?._id?.toString() ?? null),
          nickname: rv.isAnonymous ? null : (user?.nickname ?? null),
          avatar: rv.isAnonymous ? null : (user?.avatarUrl ?? null),
        }
      })

      return reply.send({ reviews: formatted, total, page, limit })
    }
  )

  // ── GET /orders/:orderId/reviews — lấy cả 2 review của 1 order ──────────
  app.get<{ Params: { orderId: string } }>(
    '/orders/:orderId/reviews',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.orderId)) {
        return reply.code(400).send({ error: 'orderId không hợp lệ' })
      }
      const order = await Order.findById(req.params.orderId)
      if (!order) return reply.code(404).send({ error: 'Không tìm thấy đơn hàng' })

      const userId = req.user!.userId
      const isCustomer = order.customerId?.toString() === userId
      const isStoreOwner = !!(await Store.exists({ _id: order.storeId, ownerId: userId, isDeleted: { $ne: true } }))
      if (!isCustomer && !isStoreOwner) {
        return reply.code(403).send({ error: 'Không có quyền xem' })
      }

      const [storeReview, customerReview] = await Promise.all([
        Review.findOne({ orderId: order._id, toEntityType: 'store' }),
        Review.findOne({ orderId: order._id, toEntityType: 'customer' }),
      ])

      const now = Date.now()
      const reviewableUntil = order.completedAt
        ? new Date(order.completedAt.getTime() + MS_30D)
        : null

      return reply.send({
        storeReview: storeReview ?? null,
        customerReview: customerReview ?? null,
        canReviewStore: isCustomer && !storeReview && !!reviewableUntil && now < reviewableUntil.getTime(),
        canReviewCustomer: isStoreOwner && !customerReview && !!reviewableUntil && now < reviewableUntil.getTime(),
        reviewableUntil,
      })
    }
  )

  // ── POST /orders/:orderId/review — khách đánh giá quán ───────────────────
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
      if (!order.completedAt || Date.now() - order.completedAt.getTime() > MS_30D) {
        return reply.code(409).send({ error: 'Đã quá 30 ngày kể từ khi đơn hoàn thành' })
      }
      const existing = await Review.findOne({ orderId: order._id, toEntityType: 'store' })
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

  // ── POST /orders/:orderId/customer-review — chủ quán đánh giá khách ──────
  app.post<{
    Params: { orderId: string }
    Body: { stars: number; comment?: string; images?: string[]; isAnonymous?: boolean }
  }>(
    '/orders/:orderId/customer-review',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.orderId)) {
        return reply.code(400).send({ error: 'orderId không hợp lệ' })
      }
      const order = await Order.findById(req.params.orderId)
      if (!order) return reply.code(404).send({ error: 'Không tìm thấy đơn hàng' })

      const store = await Store.findOne({ _id: order.storeId, ownerId: req.user!.userId, isDeleted: { $ne: true } })
      if (!store) return reply.code(403).send({ error: 'Bạn không phải chủ quán này' })

      if (!order.customerId) {
        return reply.code(409).send({ error: 'Đơn vãng lai không có tài khoản khách để đánh giá' })
      }
      if (!(['completed', 'delivered'] as string[]).includes(order.mainStatus)) {
        return reply.code(409).send({ error: 'Chỉ đánh giá được đơn đã giao / hoàn thành' })
      }
      if (!order.completedAt || Date.now() - order.completedAt.getTime() > MS_30D) {
        return reply.code(409).send({ error: 'Đã quá 30 ngày kể từ khi đơn hoàn thành' })
      }
      const existing = await Review.findOne({ orderId: order._id, toEntityType: 'customer' })
      if (existing) return reply.code(409).send({ error: 'Khách hàng này đã được đánh giá cho đơn này' })

      const review = await Review.create({
        orderId: order._id,
        fromUserId: req.user!.userId,
        toEntityType: 'customer',
        toEntityId: order.customerId,
        stars: req.body.stars as 1 | 2 | 3 | 4 | 5,
        comment: req.body.comment ?? '',
        images: req.body.images ?? [],
        isAnonymous: req.body.isAnonymous ?? false,
      })

      return reply.code(201).send(review)
    }
  )

  // ── PATCH /stores/:storeId/reviews/:reviewId/reply — quán phản hồi đánh giá ─
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

  // ── PATCH /reviews/:reviewId/customer-reply — khách phản hồi đánh giá của quán ─
  app.patch<{
    Params: { reviewId: string }
    Body: { text: string }
  }>(
    '/reviews/:reviewId/customer-reply',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.reviewId)) {
        return reply.code(400).send({ error: 'reviewId không hợp lệ' })
      }
      const review = await Review.findById(req.params.reviewId)
      if (!review) return reply.code(404).send({ error: 'Không tìm thấy đánh giá' })

      if (review.toEntityType !== 'customer') {
        return reply.code(400).send({ error: 'Chỉ khách mới được phản hồi đánh giá về khách' })
      }
      if (review.toEntityId.toString() !== req.user!.userId) {
        return reply.code(403).send({ error: 'Bạn không phải người được đánh giá' })
      }

      const deadline = replyEditDeadline(review)
      if (Date.now() > deadline.getTime()) {
        return reply.code(409).send({ error: 'Đã hết thời gian phản hồi (24h kể từ lần chủ quán chỉnh sửa cuối)' })
      }

      const now = new Date()
      review.reply = review.reply
        ? { text: req.body.text, at: review.reply.at, editedAt: now }
        : { text: req.body.text, at: now }

      await review.save()
      return reply.send(review)
    }
  )

  // ── PATCH /reviews/:reviewId — author sửa review (rolling 24h) ───────────
  app.patch<{
    Params: { reviewId: string }
    Body: { stars?: number; comment?: string; images?: string[]; isAnonymous?: boolean }
  }>(
    '/reviews/:reviewId',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.reviewId)) {
        return reply.code(400).send({ error: 'reviewId không hợp lệ' })
      }
      const review = await Review.findById(req.params.reviewId)
      if (!review) return reply.code(404).send({ error: 'Không tìm thấy đánh giá' })
      if (review.fromUserId.toString() !== req.user!.userId) {
        return reply.code(403).send({ error: 'Không có quyền sửa đánh giá này' })
      }

      const deadline = authorEditDeadline(review)
      if (Date.now() > deadline.getTime()) {
        return reply.code(409).send({ error: 'Đã hết thời gian chỉnh sửa (24h kể từ lần phản hồi cuối)' })
      }

      const { stars, comment, images, isAnonymous } = req.body
      if (stars       !== undefined) review.stars       = stars as 1 | 2 | 3 | 4 | 5
      if (comment     !== undefined) review.comment     = comment
      if (images      !== undefined) review.images      = images
      if (isAnonymous !== undefined) review.isAnonymous = isAnonymous
      review.editedAt = new Date()

      await review.save()

      // Cập nhật avgRating của quán nếu là review quán
      if (review.toEntityType === 'store') {
        const agg = await Review.aggregate([
          { $match: { toEntityId: review.toEntityId, toEntityType: 'store', isHiddenByAdmin: false } },
          { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
        ])
        if (agg[0]) {
          await Store.updateOne(
            { _id: review.toEntityId },
            { $set: { 'stats.avgRating': Math.round(agg[0].avg * 10) / 10, 'stats.totalReviews': agg[0].count } }
          )
        }
      }

      return reply.send(review)
    }
  )

  // ── DELETE /reviews/:reviewId — author xóa review (rolling 24h) ──────────
  app.delete<{ Params: { reviewId: string } }>(
    '/reviews/:reviewId',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!mongoose.isValidObjectId(req.params.reviewId)) {
        return reply.code(400).send({ error: 'reviewId không hợp lệ' })
      }
      const review = await Review.findById(req.params.reviewId)
      if (!review) return reply.code(404).send({ error: 'Không tìm thấy đánh giá' })
      if (review.fromUserId.toString() !== req.user!.userId) {
        return reply.code(403).send({ error: 'Không có quyền xoá đánh giá này' })
      }

      const deadline = authorEditDeadline(review)
      if (Date.now() > deadline.getTime()) {
        return reply.code(409).send({ error: 'Đã hết thời gian xoá (24h kể từ lần phản hồi cuối)' })
      }

      const storeId = review.toEntityId
      const wasStoreReview = review.toEntityType === 'store'
      await review.deleteOne()

      if (wasStoreReview) {
        const agg = await Review.aggregate([
          { $match: { toEntityId: storeId, toEntityType: 'store', isHiddenByAdmin: false } },
          { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
        ])
        await Store.updateOne(
          { _id: storeId },
          agg[0]
            ? { $set: { 'stats.avgRating': Math.round(agg[0].avg * 10) / 10, 'stats.totalReviews': agg[0].count } }
            : { $set: { 'stats.avgRating': 0, 'stats.totalReviews': 0 } }
        )
      }

      return reply.code(204).send()
    }
  )
}
