import type { FastifyInstance } from 'fastify'
import mongoose from 'mongoose'
import { requireAuth } from '../../middleware/auth.middleware.js'
import { requireStoreAccess } from '../../middleware/store.middleware.js'
import { StoreMembership } from '../db/store-memberships.model.js'
import { Store } from '../db/stores.model.js'
import { User } from '../db/users.model.js'
import type { ManagerPermission } from '../db/store-memberships.model.js'

const MANAGER_PERMISSIONS: ManagerPermission[] = [
  'manage_menu',
  'manage_orders',
  'manage_opening_hours',
  'manage_ship_fee',
  'manage_auto_settings',
  'emergency_close',
  'view_revenue',
  'manage_reviews',
  'inventory_import',
  'manage_staff',
]

export async function storeMembershipRoutes(app: FastifyInstance) {

  // GET /me/store-memberships — danh sách quán tôi là thành viên (spec §8.3)
  app.get('/me/store-memberships', { preHandler: requireAuth }, async (req, reply) => {
    const userId = req.user!.userId
    const memberships = await StoreMembership.find({ userId, status: 'active' })
      .populate('storeId', 'name avatar')
      .lean()

    return reply.send({
      success: true,
      data: memberships.map((m) => ({
        _id: m._id,
        storeId: (m.storeId as any)?._id ?? m.storeId,
        storeName: (m.storeId as any)?.name ?? null,
        storeAvatar: (m.storeId as any)?.avatar ?? null,
        role: m.role,
        permissions: m.permissions,
        status: m.status,
      })),
    })
  })

  // GET /stores/:storeId/members — danh sách thành viên quán
  app.get(
    '/stores/:storeId/members',
    { preHandler: [requireAuth, requireStoreAccess('manage_staff')] },
    async (req, reply) => {
      const { storeId } = req.params as any
      const members = await StoreMembership.find({ storeId, status: 'active' })
        .populate('userId', 'username nickname avatar')
        .lean()

      return reply.send({
        success: true,
        data: members.map((m) => ({
          _id: m._id,
          user: m.userId,
          role: m.role,
          permissions: m.permissions,
          invitedAt: m.invitedAt,
          acceptedAt: m.acceptedAt,
        })),
      })
    },
  )

  // POST /stores/:storeId/members/invite — mời thành viên (spec §6.1)
  app.post(
    '/stores/:storeId/members/invite',
    { preHandler: [requireAuth, requireStoreAccess('manage_staff')] },
    async (req, reply) => {
      const { storeId } = req.params as any
      const { username, role, permissions = [] } = req.body as {
        username: string
        role: 'manager' | 'staff'
        permissions?: ManagerPermission[]
      }

      if (!username || !['manager', 'staff'].includes(role)) {
        return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Thiếu username hoặc role không hợp lệ' })
      }

      // Manager chỉ được mời staff (không thể mời manager)
      const inviterId = req.user!.userId
      const store = await Store.findById(storeId).select('ownerId').lean()
      if (!store) return reply.code(404).send({ error: 'STORE_NOT_FOUND' })

      const isOwner = store.ownerId.toString() === inviterId
      if (role === 'manager' && !isOwner) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Chỉ chủ quán mới có thể mời quản lý',
        })
      }

      const targetUser = await User.findOne({ username: username.toLowerCase() }).select('_id').lean()
      if (!targetUser) {
        return reply.code(404).send({ error: 'USER_NOT_FOUND', message: 'Không tìm thấy user' })
      }

      // Không mời chính chủ quán
      if (store.ownerId.toString() === targetUser._id.toString()) {
        return reply.code(400).send({ error: 'CANNOT_INVITE_OWNER', message: 'Không thể mời chủ quán' })
      }

      // Kiểm tra đã là thành viên active chưa
      const existing = await StoreMembership.findOne({
        storeId,
        userId: targetUser._id,
        status: 'active',
      })
      if (existing) {
        return reply.code(400).send({ error: 'ALREADY_MEMBER', message: 'User đã là thành viên quán' })
      }

      // Validate permissions nếu mời manager
      const validPermissions =
        role === 'manager'
          ? permissions.filter((p) => MANAGER_PERMISSIONS.includes(p))
          : []

      const membership = await StoreMembership.create({
        storeId,
        userId: targetUser._id,
        role,
        permissions: validPermissions,
        status: 'pending',
        invitedBy: inviterId,
        invitedAt: new Date(),
      })

      return reply.code(201).send({ success: true, data: membership })
    },
  )

  // PUT /stores/:storeId/members/:userId/permissions — cập nhật permissions manager (chỉ owner)
  app.put(
    '/stores/:storeId/members/:memberId/permissions',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { storeId, memberId } = req.params as any
      const { permissions } = req.body as { permissions: ManagerPermission[] }
      const requesterId = req.user!.userId

      const store = await Store.findById(storeId).select('ownerId').lean()
      if (!store) return reply.code(404).send({ error: 'STORE_NOT_FOUND' })
      if (store.ownerId.toString() !== requesterId) {
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Chỉ chủ quán mới được cập nhật quyền' })
      }

      const membership = await StoreMembership.findOne({
        _id: memberId,
        storeId,
        role: 'manager',
        status: 'active',
      })
      if (!membership) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy manager' })
      }

      const validPermissions = permissions.filter((p) => MANAGER_PERMISSIONS.includes(p))
      membership.permissions = validPermissions
      await membership.save()

      return reply.send({ success: true, data: membership })
    },
  )

  // DELETE /stores/:storeId/members/:memberId — xoá thành viên
  app.delete(
    '/stores/:storeId/members/:memberId',
    { preHandler: [requireAuth, requireStoreAccess('manage_staff')] },
    async (req, reply) => {
      const { storeId, memberId } = req.params as any
      const requesterId = req.user!.userId

      const membership = await StoreMembership.findOne({ _id: memberId, storeId, status: 'active' })
      if (!membership) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Không tìm thấy thành viên' })
      }

      // Manager chỉ được xoá staff, không được xoá manager khác
      const store = await Store.findById(storeId).select('ownerId').lean()
      const isOwner = store?.ownerId.toString() === requesterId
      if (!isOwner && membership.role === 'manager') {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Chỉ chủ quán mới có thể xoá quản lý',
        })
      }

      membership.status = 'removed'
      membership.removedAt = new Date()
      await membership.save()

      return reply.send({ success: true })
    },
  )

  // POST /store-invitations/:invitationId/accept — chấp nhận lời mời
  app.post(
    '/store-invitations/:invitationId/accept',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { invitationId } = req.params as any
      const userId = req.user!.userId

      const membership = await StoreMembership.findOne({
        _id: invitationId,
        userId,
        status: 'pending',
      })
      if (!membership) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lời mời không tồn tại hoặc đã xử lý' })
      }

      membership.status = 'active'
      membership.acceptedAt = new Date()
      await membership.save()

      return reply.send({ success: true, data: membership })
    },
  )

  // POST /store-invitations/:invitationId/decline — từ chối lời mời
  app.post(
    '/store-invitations/:invitationId/decline',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { invitationId } = req.params as any
      const userId = req.user!.userId

      const membership = await StoreMembership.findOne({
        _id: invitationId,
        userId,
        status: 'pending',
      })
      if (!membership) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Lời mời không tồn tại hoặc đã xử lý' })
      }

      membership.status = 'removed'
      membership.removedAt = new Date()
      await membership.save()

      return reply.send({ success: true })
    },
  )
}
