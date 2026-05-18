// backend/src/middleware/auth.middleware.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../utils/jwt.js';
import type { UserRole } from '../modules/users/user.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { userId: string; roles: UserRole[] };
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  // Mobile: Authorization: Bearer <token>
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // Web: httpOnly cookie accessToken
  if (!token) {
    token = (req as any).cookies?.accessToken;
  }

  if (!token) {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Thiếu access token' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { userId: payload.userId, roles: payload.roles as UserRole[] };
  } catch {
    return reply.code(401).send({ error: 'Unauthorized', message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    await requireAuth(req, reply);
    if (reply.sent) return;

    const userRoles = req.user?.roles ?? [];
    const hasRole = allowedRoles.some((r) => userRoles.includes(r));
    if (!hasRole) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Bạn không có quyền thực hiện thao tác này' });
    }
  };
}
// backend/src/middleware/auth.middleware.ts