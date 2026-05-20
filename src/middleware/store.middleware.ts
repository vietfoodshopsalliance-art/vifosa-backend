import type { FastifyRequest, FastifyReply } from 'fastify'
import { Store } from '../modules/db/stores.model.js'
import { StoreMembership } from '../modules/db/store-memberships.model.js'

// Quyền tuyệt đối bị cấm với staff — không thể override dù owner muốn (spec SR-6)
const STAFF_FORBIDDEN_PERMISSIONS = new Set([
  'edit_bank_account',
  'edit_store_address',
  'edit_payment_methods',
  'view_revenue',
  'inventory_import',
  'manage_staff',
  'transfer_inventory',
  'create_gift_order',
  'create_void_order',
])

/**
 * Áp dụng cho mọi route /stores/:storeId/*
 * Cho phép nếu user là owner HOẶC member active có đủ permission.
 * Phải dùng sau requireAuth.
 */
export function requireStoreAccess(permission?: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const storeId = (req.params as any).storeId
    const userId = req.user!.userId

    const store = await Store.findOne({ _id: storeId, isDeleted: false }).select('ownerId').lean()
    if (!store) {
      return reply.code(404).send({ error: 'STORE_NOT_FOUND', message: 'Không tìm thấy quán' })
    }

    // Owner: toàn quyền
    if (store.ownerId.toString() === userId) return

    // Tìm membership active
    const membership = await StoreMembership.findOne({
      storeId,
      userId,
      status: 'active',
    }).lean()

    if (!membership) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Bạn không có quyền truy cập quán này' })
    }

    if (membership.role === 'staff') {
      if (permission && STAFF_FORBIDDEN_PERMISSIONS.has(permission)) {
        return reply.code(403).send({
          error: 'FORBIDDEN_FOR_STAFF',
          message: 'Nhân viên không được phép thực hiện thao tác này',
        })
      }
      // Staff có quyền mặc định (xử lý đơn, xem menu) — cho phép
      return
    }

    // Manager: kiểm tra permission cụ thể
    if (permission && !membership.permissions.includes(permission as any)) {
      return reply.code(403).send({
        error: 'MISSING_PERMISSION',
        message: `Thiếu quyền: ${permission}`,
      })
    }
  }
}
