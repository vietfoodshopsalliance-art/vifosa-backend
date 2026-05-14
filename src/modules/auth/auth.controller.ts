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
  if (err instanceof ConflictError) return reply.code(409).send({ error: 'Conflict', message: err.message });
  if (err instanceof UnauthorizedError) return reply.code(401).send({ error: 'Unauthorized', message: err.message });
  if (err instanceof ForbiddenError) return reply.code(403).send({ error: 'Forbidden', message: err.message });
  if (err instanceof NotFoundError) return reply.code(404).send({ error: 'NotFound', message: err.message });
  throw err; // rethrow cho Fastify error handler bắt
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
  const parsed = RefreshTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'ValidationError', issues: parsed.error.issues });
  }

  await AuthService.logoutUser(parsed.data.refreshToken);
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

// POST /tos/accept
export async function acceptTos(req: FastifyRequest, reply: FastifyReply) {
  const parsed = AcceptTosSchema.safeParse(req.body);
  const version = parsed.success ? parsed.data.version : '1.0';

  const { UserModel } = await import('../users/user.model.js');
  await UserModel.findByIdAndUpdate(req.user!.userId, {
    tosAcceptedAt: new Date(),
    tosVersion: version,
  });

  return reply.code(200).send({ success: true });
}