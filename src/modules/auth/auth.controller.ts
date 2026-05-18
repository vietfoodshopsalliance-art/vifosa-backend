// backend/src/modules/auth/auth.controller.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
  UpdateFcmTokenSchema,
  AcceptTosSchema,
} from './auth.schema.js';
import * as AuthService from './auth.service.js';
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from './auth.service.js';

function handleServiceError(err: unknown, reply: FastifyReply) {
  if (err instanceof ConflictError)      return reply.code(409).send({ error: 'Conflict',      message: err.message });
  if (err instanceof UnauthorizedError)  return reply.code(401).send({ error: 'Unauthorized',  message: err.message });
  if (err instanceof ForbiddenError)     return reply.code(403).send({ error: 'Forbidden',     message: err.message });
  if (err instanceof NotFoundError)      return reply.code(404).send({ error: 'NotFound',      message: err.message });
  throw err;
}

// POST /auth/register
export async function register(req: FastifyRequest, reply: FastifyReply) {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
  }
  try {
    const result = await AuthService.registerUser(parsed.data, {
      ip: req.ip,
      tosVersion: parsed.data.tosVersion,
    });
    return reply.code(201).send({ success: true, data: result });
  } catch (err) {
    handleServiceError(err, reply);
  }
}

// POST /auth/login
export async function login(req: FastifyRequest, reply: FastifyReply) {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
  }
  try {
    const result = await AuthService.loginUser(parsed.data);
    const isProd = process.env.NODE_ENV === 'production';
    reply.setCookie('accessToken', result.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      path: '/',
      maxAge: 900,
    });
    return reply.code(200).send({ success: true, data: result });
  } catch (err) {
    handleServiceError(err, reply);
  }
}

// POST /auth/refresh
export async function refresh(req: FastifyRequest, reply: FastifyReply) {
  const parsed = RefreshTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
  }
  try {
    const result = await AuthService.refreshTokens(parsed.data.refreshToken);
    return reply.code(200).send({ success: true, data: result });
  } catch (err) {
    handleServiceError(err, reply);
  }
}

// POST /auth/logout
export async function logout(req: FastifyRequest, reply: FastifyReply) {
  // Mobile flow: invalidate refresh token nếu có trong body
  const body = req.body as any;
  if (body?.refreshToken) {
    await AuthService.logoutUser(body.refreshToken).catch(() => {});
  }
  // Web flow: clear httpOnly accessToken cookie
  const isProd = process.env.NODE_ENV === 'production';
  reply.clearCookie('accessToken', {
    path: '/',
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  });
  return reply.code(200).send({ success: true, message: 'Đăng xuất thành công' });
}

// GET /me
export async function getMe(req: FastifyRequest, reply: FastifyReply) {
  const result = await AuthService.getMe(req.user!.userId);
  return reply.code(200).send({ success: true, data: result });
}

// POST /me/fcm-token
export async function addFcmToken(req: FastifyRequest, reply: FastifyReply) {
  const parsed = UpdateFcmTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
  }
  await AuthService.saveFcmToken(req.user!.userId, parsed.data.fcmToken);
  return reply.code(200).send({ success: true });
}

// DELETE /me/fcm-token
export async function removeFcmToken(req: FastifyRequest, reply: FastifyReply) {
  const parsed = UpdateFcmTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
  }
  await AuthService.removeFcmToken(req.user!.userId, parsed.data.fcmToken);
  return reply.code(200).send({ success: true });
}

// POST /me/change-password
export async function changePassword(req: FastifyRequest, reply: FastifyReply) {
  const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
  if (!oldPassword || !newPassword) {
    return reply.code(400).send({ error: 'ValidationError', message: 'Thiếu oldPassword hoặc newPassword' });
  }
  if (newPassword.length < 8) {
    return reply.code(400).send({ error: 'ValidationError', message: 'newPassword phải ít nhất 8 ký tự' });
  }
  try {
    await AuthService.changePassword(req.user!.userId, oldPassword, newPassword);
    return reply.code(200).send({ success: true, message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' });
  } catch (err) {
    handleServiceError(err, reply);
  }
}

// POST /tos/accept
export async function acceptTos(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as any;
  const version = body.tosVersion ?? body.version ?? '1.0';
  const { UserModel } = await import('../users/user.model.js');
  await UserModel.findByIdAndUpdate(req.user!.userId, {
    tosAcceptedAt: new Date(),
    tosVersion: version,
  });
  return reply.code(200).send({ success: true });
}

export { addFcmToken as saveFcmToken }

// POST /admin/reset-password
export async function adminResetPassword(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.body as { userId: string };
  if (!userId) return reply.code(400).send({ error: 'ValidationError', message: 'Thiếu userId' });
  try {
    const newPassword = await AuthService.adminResetPassword(userId);
    return reply.code(200).send({ success: true, data: { newPassword } });
  } catch (err) {
    handleServiceError(err, reply);
  }
}
