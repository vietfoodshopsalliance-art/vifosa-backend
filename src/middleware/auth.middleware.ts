import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '../utils/jwt.js'
import { User } from '../modules/db/users.model.js'
import type { UserRole } from '../modules/db/users.model.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; roles: UserRole[] }
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  let token: string | undefined

  const authHeader = req.headers.authorization
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  }

  if (!token) {
    token = (req as any).cookies?.accessToken
  }

  if (!token) {
    return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Thiếu access token' })
  }

  let payload: { sub: string }
  try {
    payload = verifyAccessToken(token)
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') {
      return reply.code(401).send({ error: 'TOKEN_EXPIRED', message: 'Access token hết hạn' })
    }
    return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Token không hợp lệ' })
  }

  // Kiểm tra user còn active và lấy roles mới nhất từ DB (không tin roles trong JWT)
  const user = await User.findById(payload.sub).select('isActive roles').lean()
  if (!user || !user.isActive) {
    return reply.code(401).send({ error: 'ACCOUNT_SUSPENDED', message: 'Tài khoản bị khoá hoặc không tồn tại' })
  }

  req.user = { userId: payload.sub, roles: user.roles as UserRole[] }
}

export function requireRole(allowedRoles: UserRole[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    await requireAuth(req, reply)
    if (reply.sent) return

    const userRoles = req.user?.roles ?? []
    const hasRole = allowedRoles.some((r) => userRoles.includes(r))
    if (!hasRole) {
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện thao tác này' })
    }
  }
}
