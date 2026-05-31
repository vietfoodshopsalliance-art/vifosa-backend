import { FastifyRequest, FastifyReply } from 'fastify'
import mongoose from 'mongoose'
import { User as UserModel } from '../../db/users.model.js'
import { adminResetPassword as doResetPassword } from '../../auth/auth.service.js'
import { RefreshToken } from '../../db/refresh-tokens.model.js'
import { AuditLog } from '../../db/misc.model.js'
import { Store, Order, Review } from '../../db/index.js'

const ALLOWED_GRANTABLE_ROLES = ['mod', 'admin', 'store_owner'] as const

const STATS_SORT_FIELDS = ['purchaseCount', 'reviewCount', 'storeRating']

const SORT_FIELD_MAP: Record<string, string> = {
  username:      'username',
  exp:           'exp',
  roles:         '_roleRank',
  vip:           '_vipRank',
  status:        'isActive',
  purchaseCount: '_stats.orderStats.completed',
  reviewCount:   '_stats.reviewsGiven',
  storeRating:   '_stats.storeRating.avg',
}

// GET /admin/users
export async function listUsers(req: FastifyRequest, reply: FastifyReply) {
  const { search, limit = '20', cursor, stats, sortBy, sortDir: sortDirQ, page } = req.query as any
  const pageSize = Math.min(Number(limit) || 20, 100)

  const matchStage: Record<string, any> = {}
  if (search) {
    matchStage.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email:    { $regex: search, $options: 'i' } },
      { nickname: { $regex: search, $options: 'i' } },
    ]
  }

  const includeStats = stats === '1' || STATS_SORT_FIELDS.includes(sortBy)

  // ── Cursor-based path (no sort column selected) ───────────────────────────
  if (!sortBy) {
    if (cursor) matchStage._id = { $lt: new mongoose.Types.ObjectId(String(cursor)) }
    const users = await UserModel.find(matchStage)
      .sort({ _id: -1 })
      .limit(pageSize + 1)
      .select('-passwordHash -fcmTokens')
      .lean()
    const hasMore = users.length > pageSize
    let items: any[] = users.slice(0, pageSize)

    if (includeStats && items.length > 0) {
      const userIds = items.map((u) => new mongoose.Types.ObjectId(String(u._id)))
      const [orderAgg, reviewGivenAgg, storeRatingAgg] = await Promise.all([
        Order.aggregate([
          { $match: { customerId: { $in: userIds } } },
          { $group: { _id: '$customerId', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $in: ['$mainStatus', ['completed', 'delivered']] }, 1, 0] } } } },
        ]),
        Review.aggregate([
          { $match: { fromUserId: { $in: userIds }, toEntityType: 'store' } },
          { $group: { _id: '$fromUserId', count: { $sum: 1 } } },
        ]),
        Review.aggregate([
          { $match: { toEntityId: { $in: userIds }, toEntityType: 'customer' } },
          { $group: { _id: '$toEntityId', avg: { $avg: '$stars' }, count: { $sum: 1 } } },
        ]),
      ])
      const orderMap  = new Map(orderAgg.map((s: any)       => [String(s._id), s]))
      const reviewMap = new Map(reviewGivenAgg.map((s: any) => [String(s._id), s]))
      const ratingMap = new Map(storeRatingAgg.map((s: any) => [String(s._id), s]))
      items = items.map((u) => {
        const id = String(u._id)
        const ord = orderMap.get(id) as any
        const rev = ratingMap.get(id) as any
        return {
          ...u,
          _stats: {
            orderStats:   { total: ord?.total ?? 0, completed: ord?.completed ?? 0 },
            reviewsGiven: (reviewMap.get(id) as any)?.count ?? 0,
            storeRating:  rev ? { avg: Math.round(rev.avg * 10) / 10, count: rev.count } : null,
          },
        }
      })
    }

    return reply.send({ users: items, nextCursor: hasMore ? String(items[items.length - 1]._id) : undefined })
  }

  // ── Aggregation path (sort column selected → page-number pagination) ───────
  const pageNum = Math.max(Number(page) || 1, 1)
  const dir     = sortDirQ === 'desc' ? -1 : 1

  const pipeline: any[] = [
    { $match: matchStage },
    { $project: { passwordHash: 0, fcmTokens: 0 } },
  ]

  // Computed vip rank for sort-by-vip
  if (sortBy === 'vip') {
    pipeline.push({
      $addFields: {
        _vipRank: {
          $switch: {
            branches: [
              { case: { $eq: ['$vipTier', 'none']  }, then: 0 },
              { case: { $eq: ['$vipTier', 'vip']   }, then: 1 },
              { case: { $eq: ['$vipTier', 'vvip']  }, then: 2 },
              { case: { $eq: ['$vipTier', 'vvvip'] }, then: 3 },
            ],
            default: 0,
          },
        },
      },
    })
  }

  // Computed role rank for sort-by-roles
  if (sortBy === 'roles') {
    pipeline.push({
      $addFields: {
        _roleRank: {
          $min: {
            $map: {
              input: '$roles', as: 'r',
              in: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$$r', 'admin'] },       then: 0 },
                    { case: { $eq: ['$$r', 'mod'] },         then: 1 },
                    { case: { $eq: ['$$r', 'store_owner'] }, then: 2 },
                  ],
                  default: 3,
                },
              },
            },
          },
        },
      },
    })
  }

  // Stats lookup (required for stats-based sort AND when stats=1)
  if (includeStats) {
    pipeline.push(
      {
        $lookup: {
          from: 'orders',
          let: { uid: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$customerId', '$$uid'] } } },
            { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: [{ $in: ['$mainStatus', ['completed', 'delivered']] }, 1, 0] } } } },
          ],
          as: '_orderAgg',
        },
      },
      {
        $lookup: {
          from: 'reviews',
          let: { uid: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$fromUserId', '$$uid'] }, { $eq: ['$toEntityType', 'store'] }] } } },
            { $count: 'count' },
          ],
          as: '_reviewGivenAgg',
        },
      },
      {
        $lookup: {
          from: 'reviews',
          let: { uid: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$toEntityId', '$$uid'] }, { $eq: ['$toEntityType', 'customer'] }] } } },
            { $group: { _id: null, avg: { $avg: '$stars' }, count: { $sum: 1 } } },
          ],
          as: '_ratingAgg',
        },
      },
      {
        $addFields: {
          _stats: {
            orderStats: {
              total:     { $ifNull: [{ $arrayElemAt: ['$_orderAgg.total',     0] }, 0] },
              completed: { $ifNull: [{ $arrayElemAt: ['$_orderAgg.completed', 0] }, 0] },
            },
            reviewsGiven: { $ifNull: [{ $arrayElemAt: ['$_reviewGivenAgg.count', 0] }, 0] },
            storeRating: {
              $cond: {
                if:   { $gt: [{ $size: '$_ratingAgg' }, 0] },
                then: { avg: { $round: [{ $arrayElemAt: ['$_ratingAgg.avg', 0] }, 1] }, count: { $arrayElemAt: ['$_ratingAgg.count', 0] } },
                else: null,
              },
            },
          },
        },
      },
      { $unset: ['_orderAgg', '_reviewGivenAgg', '_ratingAgg'] },
    )
  }

  const sortField = SORT_FIELD_MAP[sortBy] ?? '_id'
  pipeline.push({ $sort: { [sortField]: dir, _id: dir } })

  // Count for pagination
  const [countRes] = await UserModel.aggregate([{ $match: matchStage }, { $count: 'n' }])
  const totalCount = countRes?.n ?? 0
  const totalPages = Math.ceil(totalCount / pageSize) || 1

  pipeline.push({ $skip: (pageNum - 1) * pageSize }, { $limit: pageSize })

  const rawItems = await UserModel.aggregate(pipeline)
  const items = rawItems.map(({ _roleRank, _vipRank, ...rest }: any) => rest)

  return reply.send({ users: items, page: pageNum, totalPages, totalCount })
}

// GET /admin/users/:userId
export async function getUser(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as any
  const user = await UserModel.findById(userId).select('-passwordHash -fcmTokens').lean()
  if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User không tồn tại' })
  return reply.send({ user })
}

// PUT /admin/users/:userId/status  — khoá hoặc mở tài khoản
export async function updateStatus(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as any
  const { isActive } = req.body as any

  if (typeof isActive !== 'boolean') {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'isActive phải là boolean' })
  }

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: { isActive } },
    { new: true },
  ).select('-passwordHash -fcmTokens')

  if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User không tồn tại' })

  // Khi khoá: force logout toàn bộ thiết bị
  if (!isActive) {
    await RefreshToken.deleteMany({ userId })
  }

  await AuditLog.create({
    actorId: (req as any).user.userId,
    actorRole: 'admin',
    action: isActive ? 'user.unsuspend' : 'user.suspend',
    targetType: 'user',
    targetId: userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? '',
  })

  return reply.send({ success: true, user })
}

// POST /admin/users/:userId/roles  — thêm role (chỉ mod hoặc admin)
export async function addRole(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as any
  const { role } = req.body as any

  if (!ALLOWED_GRANTABLE_ROLES.includes(role)) {
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: `Chỉ có thể gán role: ${ALLOWED_GRANTABLE_ROLES.join(', ')}`,
    })
  }

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $addToSet: { roles: role } },
    { new: true },
  ).select('-passwordHash -fcmTokens')

  if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User không tồn tại' })

  await AuditLog.create({
    actorId: (req as any).user.userId,
    actorRole: 'admin',
    action: 'role.grant',
    targetType: 'user',
    targetId: userId,
    after: { role },
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? '',
  })

  return reply.send({ success: true, user })
}

// DELETE /admin/users/:userId/roles/:role  — xoá role khỏi user
export async function removeRole(req: FastifyRequest, reply: FastifyReply) {
  const { userId, role } = req.params as any

  if (!ALLOWED_GRANTABLE_ROLES.includes(role)) {
    return reply.code(400).send({
      error: 'VALIDATION_ERROR',
      message: `Chỉ có thể xoá role: ${ALLOWED_GRANTABLE_ROLES.join(', ')}`,
    })
  }

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $pull: { roles: role } },
    { new: true },
  ).select('-passwordHash -fcmTokens')

  if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User không tồn tại' })

  await AuditLog.create({
    actorId: (req as any).user.userId,
    actorRole: 'admin',
    action: 'role.revoke',
    targetType: 'user',
    targetId: userId,
    before: { role },
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? '',
  })

  return reply.send({ success: true, user })
}

// POST /admin/users/:userId/reset-password
export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as any
  try {
    const newPassword = await doResetPassword(userId)
    await AuditLog.create({
      actorId: (req as any).user.userId,
      actorRole: 'admin',
      action: 'user.reset_password',
      targetType: 'user',
      targetId: userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'] ?? '',
    })
    return reply.send({ success: true, data: { newPassword } })
  } catch (err: any) {
    return reply.code(404).send({ error: 'USER_NOT_FOUND', message: err.message })
  }
}

// POST /admin/users/:userId/logout-all
export async function adminLogoutAll(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as any
  const deleted = await RefreshToken.deleteMany({ userId })
  if (deleted.deletedCount === 0 && !(await UserModel.exists({ _id: userId }))) {
    return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User không tồn tại' })
  }
  return reply.send({ success: true, message: 'Đã đăng xuất toàn bộ thiết bị' })
}

// DELETE /admin/users/:userId  — soft delete
export async function deleteUser(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as any
  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: { isActive: false, username: `deleted_${userId}`, email: `deleted_${userId}@void.local` } },
    { new: true },
  )
  if (!user) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User không tồn tại' })
  await RefreshToken.deleteMany({ userId })
  return reply.send({ success: true })
}

// PATCH /admin/users/:userId/vip-tier
export async function updateVipTier(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as any
  const { tier } = req.body as any

  const VALID_TIERS = ['none', 'vip', 'vvip', 'vvvip']
  if (!VALID_TIERS.includes(tier)) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', message: `tier phải là một trong: ${VALID_TIERS.join(', ')}` })
  }

  const existing = await UserModel.findById(userId).select('vipTier').lean()
  if (!existing) return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'User không tồn tại' })

  const user = await UserModel.findByIdAndUpdate(
    userId,
    { $set: { vipTier: tier } },
    { new: true },
  ).select('-passwordHash -fcmTokens')

  // Đồng bộ vipTier xuống tất cả store của user này
  if (tier === 'none') {
    await Store.updateMany(
      { ownerId: userId, isDeleted: { $ne: true } },
      { $set: { vipTier: 'none' }, $unset: { vipExpiresAt: 1 } },
    )
  } else {
    await Store.updateMany(
      { ownerId: userId, isDeleted: { $ne: true } },
      { $set: { vipTier: tier, vipExpiresAt: new Date('2099-12-31T23:59:59Z') } },
    )
  }

  await AuditLog.create({
    actorId: (req as any).user.userId,
    actorRole: 'admin',
    action: 'user.vip_tier_update',
    targetType: 'user',
    targetId: userId,
    before: { vipTier: existing.vipTier },
    after: { vipTier: tier },
    ip: req.ip,
    userAgent: req.headers['user-agent'] ?? '',
  })

  return reply.send({ success: true, user })
}

// GET /admin/users/:userId/audit-log
export async function getUserAuditLog(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as any
  const logs = await AuditLog.find({ targetType: 'user', targetId: userId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()
  return reply.send({ logs })
}
