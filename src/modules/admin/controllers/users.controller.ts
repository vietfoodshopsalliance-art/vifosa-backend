import { FastifyRequest, FastifyReply } from 'fastify'
import { User as UserModel } from '../../db/users.model.js'
import { adminResetPassword as doResetPassword } from '../../auth/auth.service.js'
import { RefreshToken } from '../../db/refresh-tokens.model.js'
import { AuditLog } from '../../db/misc.model.js'
import { Store } from '../../db/index.js'

const ALLOWED_GRANTABLE_ROLES = ['mod', 'admin', 'store_owner'] as const

// GET /admin/users
export async function listUsers(req: FastifyRequest, reply: FastifyReply) {
  const { search, limit = '20', cursor } = req.query as any
  const pageSize = Math.min(Number(limit) || 20, 100)
  const query: Record<string, any> = {}
  if (search) {
    query.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { nickname: { $regex: search, $options: 'i' } },
    ]
  }
  if (cursor) query._id = { $lt: cursor }
  const users = await UserModel.find(query)
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .select('-passwordHash -fcmTokens')
    .lean()
  const hasMore = users.length > pageSize
  const items = users.slice(0, pageSize)
  return reply.send({ users: items, nextCursor: hasMore ? String(items[items.length - 1]._id) : undefined })
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
