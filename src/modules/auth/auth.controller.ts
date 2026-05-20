import type { FastifyRequest, FastifyReply } from 'fastify'
import {
  RegisterSchema,
  LoginSchema,
  RefreshTokenSchema,
  UpdateFcmTokenSchema,
} from './auth.schema.js'
import * as AuthService from './auth.service.js'
import {
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from './auth.service.js'

function handleServiceError(err: unknown, reply: FastifyReply) {
  if (err instanceof ConflictError)
    return reply.code(409).send({ error: err.code, message: err.message })
  if (err instanceof UnauthorizedError)
    return reply.code(401).send({ error: err.code, message: err.message })
  if (err instanceof ForbiddenError)
    return reply.code(403).send({ error: err.code, message: err.message })
  if (err instanceof NotFoundError)
    return reply.code(404).send({ error: err.code, message: err.message })
  if (err instanceof ValidationError)
    return reply.code(400).send({ error: err.code, message: err.message })
  throw err
}

// POST /auth/register
export async function register(req: FastifyRequest, reply: FastifyReply) {
  const parsed = RegisterSchema.safeParse(req.body)
  if (!parsed.success) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
  }
  try {
    const result = await AuthService.registerUser(parsed.data, {
      ip: req.ip,
      tosVersion: parsed.data.tosVersion,
      userAgent: req.headers['user-agent'],
    })
    return reply.code(201).send({ success: true, data: result })
  } catch (err) {
    return handleServiceError(err, reply)
  }
}

// POST /auth/login
export async function login(req: FastifyRequest, reply: FastifyReply) {
  const parsed = LoginSchema.safeParse(req.body)
  if (!parsed.success) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
  }
  try {
    const result = await AuthService.loginUser(parsed.data, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
    // Web flow: set httpOnly cookie (mobile đọc từ response body)
    reply.setCookie('accessToken', result.accessToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: 15 * 60, // 15 phút — khớp với JWT TTL
    })
    return reply.code(200).send({ success: true, data: result })
  } catch (err) {
    return handleServiceError(err, reply)
  }
}

// POST /auth/refresh
export async function refresh(req: FastifyRequest, reply: FastifyReply) {
  const parsed = RefreshTokenSchema.safeParse(req.body)
  if (!parsed.success) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
  }
  try {
    const result = await AuthService.refreshTokens(parsed.data.refreshToken, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    })
    return reply.code(200).send({ success: true, data: result })
  } catch (err) {
    return handleServiceError(err, reply)
  }
}

// POST /auth/logout
export async function logout(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as any
  if (body?.refreshToken) {
    await AuthService.logoutUser(body.refreshToken).catch(() => {})
  }
  reply.clearCookie('accessToken', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  })
  return reply.code(200).send({ success: true, message: 'Đăng xuất thành công' })
}

// POST /auth/logout-all
export async function logoutAll(req: FastifyRequest, reply: FastifyReply) {
  await AuthService.logoutAllDevices(req.user!.userId)
  reply.clearCookie('accessToken', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  })
  return reply.code(200).send({ success: true, message: 'Đã đăng xuất tất cả thiết bị' })
}

// GET /me
export async function getMe(req: FastifyRequest, reply: FastifyReply) {
  const result = await AuthService.getMe(req.user!.userId)
  return reply.code(200).send({ success: true, data: result })
}

// POST /me/fcm-token
export async function addFcmToken(req: FastifyRequest, reply: FastifyReply) {
  const parsed = UpdateFcmTokenSchema.safeParse(req.body)
  if (!parsed.success) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
  }
  await AuthService.saveFcmToken(req.user!.userId, parsed.data.fcmToken)
  return reply.code(200).send({ success: true })
}

// DELETE /me/fcm-token
export async function removeFcmToken(req: FastifyRequest, reply: FastifyReply) {
  const parsed = UpdateFcmTokenSchema.safeParse(req.body)
  if (!parsed.success) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', issues: parsed.error.issues })
  }
  await AuthService.removeFcmToken(req.user!.userId, parsed.data.fcmToken)
  return reply.code(200).send({ success: true })
}

// POST /me/change-password  (alias PUT /me/password per spec)
export async function changePassword(req: FastifyRequest, reply: FastifyReply) {
  const { oldPassword, newPassword } = req.body as {
    oldPassword?: string
    newPassword?: string
  }
  if (!oldPassword || !newPassword) {
    return reply
      .code(400)
      .send({ error: 'VALIDATION_ERROR', message: 'Thiếu oldPassword hoặc newPassword' })
  }
  if (newPassword.length < 8) {
    return reply
      .code(400)
      .send({ error: 'VALIDATION_ERROR', message: 'newPassword phải ít nhất 8 ký tự' })
  }
  try {
    await AuthService.changePassword(req.user!.userId, oldPassword, newPassword)
    return reply
      .code(200)
      .send({ success: true, message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.' })
  } catch (err) {
    return handleServiceError(err, reply)
  }
}

// POST /admin/users/:userId/reset-password
export async function adminResetPassword(req: FastifyRequest, reply: FastifyReply) {
  const { userId } = req.params as { userId?: string }
  const targetId = userId ?? (req.body as any)?.userId
  if (!targetId) {
    return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Thiếu userId' })
  }
  try {
    const newPassword = await AuthService.adminResetPassword(targetId)
    return reply.code(200).send({ success: true, data: { newPassword } })
  } catch (err) {
    return handleServiceError(err, reply)
  }
}

// Compat export (dùng bởi users.routes.ts dynamic import)
export { addFcmToken as saveFcmToken }
