import bcrypt from 'bcrypt'
import { User } from '../db/users.model.js'
import { Store } from '../db/stores.model.js'
import { StoreMembership } from '../db/store-memberships.model.js'
import { RefreshToken } from '../db/refresh-tokens.model.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js'
import type { RegisterInput, LoginInput } from './auth.schema.js'

const BCRYPT_ROUNDS = 12
const TOKEN_HASH_ROUNDS = 10   // token đã random cao entropy, dùng cost thấp hơn password
const REFRESH_TTL_DAYS = 30

// ── Custom Errors ─────────────────────────────────────────────────────────────
export class ConflictError extends Error {
  constructor(message: string, public code: string) { super(message) }
}
export class UnauthorizedError extends Error {
  constructor(message: string, public code: string = 'UNAUTHORIZED') { super(message) }
}
export class ForbiddenError extends Error {
  constructor(message: string, public code: string = 'FORBIDDEN') { super(message) }
}
export class NotFoundError extends Error {
  constructor(message: string, public code: string = 'NOT_FOUND') { super(message) }
}
export class ValidationError extends Error {
  constructor(message: string, public code: string = 'VALIDATION_ERROR') { super(message) }
}

// ── Refresh token helpers ─────────────────────────────────────────────────────

function detectPlatform(userAgent: string): 'android' | 'ios' | 'web' | 'unknown' {
  const ua = userAgent.toLowerCase()
  if (ua.includes('android')) return 'android'
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios'
  if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari')) return 'web'
  return 'unknown'
}

async function storeRefreshToken(
  userId: string,
  rawToken: string,
  jti: string,
  req?: { ip?: string; headers?: Record<string, string | string[] | undefined> },
) {
  const userAgent = String(req?.headers?.['user-agent'] ?? '')
  const tokenHash = await bcrypt.hash(rawToken, TOKEN_HASH_ROUNDS)
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
  await RefreshToken.create({
    jti,
    userId,
    tokenHash,
    deviceInfo: {
      userAgent,
      ip: req?.ip ?? '',
      platform: detectPlatform(userAgent),
    },
    issuedAt: new Date(),
    expiresAt,
  })
}

// ── Register ──────────────────────────────────────────────────────────────────
export async function registerUser(
  input: RegisterInput,
  meta: { ip: string; tosVersion: string; userAgent?: string },
) {
  const { username, nickname, email, phone, password } = input

  const existing = await User.findOne({
    $or: [
      { username: username.toLowerCase() },
      { email: email.toLowerCase() },
      { phone },
    ],
  })

  if (existing) {
    if (existing.username === username.toLowerCase())
      throw new ConflictError('Username đã tồn tại', 'USERNAME_TAKEN')
    if (existing.email === email.toLowerCase())
      throw new ConflictError('Email đã tồn tại', 'EMAIL_TAKEN')
    if (existing.phone === phone)
      throw new ConflictError('Số điện thoại đã tồn tại', 'PHONE_TAKEN')
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  const user = await User.create({
    username: username.toLowerCase(),
    nickname,
    email: email.toLowerCase(),
    phone,
    passwordHash,
    roles: ['customer'],
    tosAcceptedAt: new Date(),
    tosVersion: meta.tosVersion,
    tosAcceptedIp: meta.ip,
  })

  const userId = user._id.toString()
  const accessToken = signAccessToken(userId)
  const { token: refreshToken, jti } = signRefreshToken(userId)

  await storeRefreshToken(userId, refreshToken, jti, {
    ip: meta.ip,
    headers: meta.userAgent ? { 'user-agent': meta.userAgent } : {},
  })

  return {
    accessToken,
    refreshToken,
    user: {
      _id: userId,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      phone: user.phone,
      roles: user.roles,
      avatar: user.avatar ?? null,
      isActive: user.isActive,
      notificationPrefs: user.notificationPrefs,
      tosAcceptedAt: user.tosAcceptedAt,
      tosVersion: user.tosVersion,
    },
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
export async function loginUser(
  input: LoginInput,
  meta?: { ip?: string; userAgent?: string },
) {
  const { identifier, password } = input

  const user = await User.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { phone: identifier },
      { username: identifier.toLowerCase() },
    ],
  })

  if (!user) throw new UnauthorizedError('Thông tin đăng nhập không hợp lệ', 'UNAUTHORIZED')
  if (!user.isActive) throw new ForbiddenError('Tài khoản đã bị khoá', 'ACCOUNT_SUSPENDED')

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw new UnauthorizedError('Thông tin đăng nhập không hợp lệ', 'UNAUTHORIZED')

  const userId = user._id.toString()
  const accessToken = signAccessToken(userId)
  const { token: refreshToken, jti } = signRefreshToken(userId)

  const [, ownedStore] = await Promise.all([
    storeRefreshToken(userId, refreshToken, jti, {
      ip: meta?.ip,
      headers: meta?.userAgent ? { 'user-agent': meta.userAgent } : {},
    }),
    Store.findOne({ ownerId: userId, isDeleted: false }).select('_id').lean(),
  ])

  return {
    accessToken,
    refreshToken,
    user: {
      _id: userId,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      phone: user.phone,
      roles: user.roles,
      avatar: user.avatar ?? null,
      isActive: user.isActive,
      notificationPrefs: user.notificationPrefs,
      tosAcceptedAt: user.tosAcceptedAt,
      tosVersion: user.tosVersion,
      storeId: ownedStore?._id?.toString() ?? '',
    },
  }
}

// ── Refresh ───────────────────────────────────────────────────────────────────
export async function refreshTokens(
  oldRawToken: string,
  meta?: { ip?: string; userAgent?: string },
) {
  let payload: { sub: string; jti: string }
  try {
    payload = verifyRefreshToken(oldRawToken) as { sub: string; jti: string }
  } catch {
    throw new UnauthorizedError('Refresh token không hợp lệ hoặc đã hết hạn', 'UNAUTHORIZED')
  }

  const { sub: userId, jti } = payload

  // Tìm token theo jti (O(1) lookup)
  const stored = await RefreshToken.findOne({ jti, revokedAt: { $exists: false } })
  if (!stored) {
    // Có thể đây là replay attack — force logout toàn bộ thiết bị
    await RefreshToken.deleteMany({ userId })
    throw new UnauthorizedError('Refresh token đã được sử dụng hoặc không hợp lệ', 'UNAUTHORIZED')
  }

  // Verify hash
  const hashMatch = await bcrypt.compare(oldRawToken, stored.tokenHash)
  if (!hashMatch) {
    await RefreshToken.deleteMany({ userId })
    throw new UnauthorizedError('Refresh token không hợp lệ', 'UNAUTHORIZED')
  }

  const user = await User.findById(userId).select('isActive roles').lean()
  if (!user || !user.isActive) {
    throw new UnauthorizedError('Tài khoản không tồn tại hoặc bị khoá', 'ACCOUNT_SUSPENDED')
  }

  // Rotate: xoá token cũ, tạo token mới
  await RefreshToken.findByIdAndDelete(stored._id)

  const accessToken = signAccessToken(userId)
  const { token: newRefreshToken, jti: newJti } = signRefreshToken(userId)

  await storeRefreshToken(userId, newRefreshToken, newJti, {
    ip: meta?.ip,
    headers: meta?.userAgent ? { 'user-agent': meta.userAgent } : {},
  })

  return { accessToken, refreshToken: newRefreshToken }
}

// ── Logout (thiết bị hiện tại) ────────────────────────────────────────────────
export async function logoutUser(rawRefreshToken: string) {
  try {
    const payload = verifyRefreshToken(rawRefreshToken) as { sub: string; jti: string }
    await RefreshToken.findOneAndDelete({ jti: payload.jti })
  } catch {
    // token không hợp lệ — không cần làm gì
  }
}

// ── Logout all (toàn bộ thiết bị) ────────────────────────────────────────────
export async function logoutAllDevices(userId: string) {
  await RefreshToken.deleteMany({ userId })
}

// ── Get Me ────────────────────────────────────────────────────────────────────
export async function getMe(userId: string) {
  const [user, ownedStores, memberships] = await Promise.all([
    User.findById(userId)
      .select('-passwordHash -fcmTokens')
      .lean(),
    Store.find({ ownerId: userId, isDeleted: false })
      .select('_id name')
      .lean(),
    StoreMembership.find({ userId, status: 'active' })
      .populate('storeId', 'name')
      .lean(),
  ])

  if (!user) throw new NotFoundError('User không tồn tại', 'NOT_FOUND')

  // Self-heal: nếu user có store nhưng thiếu store_owner role (có thể xảy ra
  // khi store được tạo trước fix role-auto-assign), tự thêm role vào DB.
  if (ownedStores.length > 0 && !(user.roles as string[]).includes('store_owner')) {
    await User.findByIdAndUpdate(userId, { $addToSet: { roles: 'store_owner' } })
    ;(user as any).roles = [...(user.roles as string[]), 'store_owner']
  }

  return {
    ...user,
    ownedStores: ownedStores.map((s) => ({ _id: s._id, name: s.name })),
    storeMemberships: memberships.map((m) => ({
      _id: m._id,
      storeId: (m.storeId as any)?._id ?? m.storeId,
      storeName: (m.storeId as any)?.name ?? null,
      role: m.role,
      permissions: m.permissions,
      status: m.status,
    })),
  }
}

// ── FCM Token ─────────────────────────────────────────────────────────────────
export async function saveFcmToken(userId: string, token: string) {
  await User.findByIdAndUpdate(userId, { $addToSet: { fcmTokens: token } })
}

export async function removeFcmToken(userId: string, token: string) {
  await User.findByIdAndUpdate(userId, { $pull: { fcmTokens: token } })
}

// ── Change Password ───────────────────────────────────────────────────────────
export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
) {
  const user = await User.findById(userId)
  if (!user) throw new NotFoundError('User không tồn tại', 'NOT_FOUND')

  const valid = await bcrypt.compare(oldPassword, user.passwordHash)
  if (!valid) throw new ValidationError('Mật khẩu hiện tại không đúng', 'WRONG_PASSWORD')

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await User.findByIdAndUpdate(userId, { passwordHash })

  // Force logout toàn bộ thiết bị (spec UA-7)
  await RefreshToken.deleteMany({ userId })
}

// ── Admin reset password ──────────────────────────────────────────────────────
export async function adminResetPassword(targetUserId: string): Promise<string> {
  const user = await User.findById(targetUserId)
  if (!user) throw new NotFoundError('User không tồn tại', 'USER_NOT_FOUND')

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const newPassword = Array.from({ length: 12 }, () =>
    chars[Math.floor(Math.random() * chars.length)],
  ).join('')

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await User.findByIdAndUpdate(targetUserId, { passwordHash })
  await RefreshToken.deleteMany({ userId: targetUserId })

  return newPassword
}

// ── Compat re-export (dùng trong users.routes.ts) ────────────────────────────
export const clearAllRefreshTokens = logoutAllDevices
