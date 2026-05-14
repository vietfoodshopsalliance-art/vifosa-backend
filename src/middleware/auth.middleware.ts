// backend/src/middleware/auth.middleware.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/jwt.js';
import type { UserRole } from '../modules/users/user.types.js';

// Extend FastifyRequest để TypeScript hiểu req.user
declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; roles: UserRole[] };
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Thiếu access token' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { userId: payload.userId, roles: payload.roles as UserRole[] };
  } catch {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

// Factory: requireRole(['admin']) hoặc requireRole(['admin', 'mod'])
export function requireRole(allowedRoles: UserRole[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    await requireAuth(req, reply);
    if (reply.sent) return; // đã 401 từ requireAuth

    const userRoles = req.user?.roles ?? [];
    const hasRole = allowedRoles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Bạn không có quyền thực hiện thao tác này' });
    }
  };
}