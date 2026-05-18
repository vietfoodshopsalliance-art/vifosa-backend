import bcrypt from 'bcrypt'
import { User } from '../db/users.model.js'
import { Store } from '../stores/store.model.js'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js'
import type { RegisterInput, LoginInput } from './auth.schema.js'

const BCRYPT_ROUNDS = 12

// ── Custom Errors ─────────────────────────────────────────────────────────────
export class ConflictError extends Error {}
export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}
export class NotFoundError extends Error {}

// ── Refresh token store (MongoDB-backed, survives server restarts) ────────────

async function addRefreshToken(userId: string, token: string) {
  await User.findByIdAndUpdate(userId, { $addToSet: { refreshTokens: token } })
}

async function removeRefreshToken(userId: string, token: string) {
  await User.findByIdAndUpdate(userId, { $pull: { refreshTokens: token } })
}

export async function clearAllRefreshTokens(userId: string) {
  await User.findByIdAndUpdate(userId, { $set: { refreshTokens: [] } })
}

async function hasRefreshToken(userId: string, token: string): Promise<boolean> {
  const user = await User.findById(userId).select('refreshTokens').lean()
  return user?.refreshTokens?.includes(token) ?? false
}

// ── Register ──────────────────────────────────────────────────────────────────
export async function registerUser(
  input: RegisterInput,
  meta: { ip: string; tosVersion: string },
) {
  const { username, nickname, email, phone, password } = input

  const exists = await User.findOne({
    $or: [{ username }, { email: email.toLowerCase() }, { phone }],
  })
  if (exists) {
    if (exists.username === username) throw new ConflictError('Username đã tồn tại')
    if (exists.email === email.toLowerCase()) throw new ConflictError('Email đã tồn tại')
    if (exists.phone === phone) throw new ConflictError('Số điện thoại đã tồn tại')
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
  })

  const userId = user._id.toString()
  const accessToken = signAccessToken({ userId, roles: user.roles })
  const refreshToken = signRefreshToken({ userId })
  await addRefreshToken(userId, refreshToken)

  return {
    accessToken,
    refreshToken,
    user: { _id: userId, username: user.username, nickname: user.nickname, roles: user.roles },
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
export async function loginUser(input: LoginInput) {
  const { identifier, password } = input

  const user = await User.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { phone: identifier },
      { username: identifier.toLowerCase() },
    ],
  })

  if (!user) throw new UnauthorizedError('Thông tin đăng nhập không hợp lệ')
  if (!user.isActive) throw new ForbiddenError('Tài khoản đã bị khoá')

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw new UnauthorizedError('Thông tin đăng nhập không hợp lệ')

  const userId = user._id.toString()
  const accessToken = signAccessToken({ userId, roles: user.roles })
  const refreshToken = signRefreshToken({ userId })
  await addRefreshToken(userId, refreshToken)

  return {
    accessToken,
    refreshToken,
    user: { _id: userId, username: user.username, nickname: user.nickname, roles: user.roles },
  }
}

// ── Refresh ───────────────────────────────────────────────────────────────────
export async function refreshTokens(oldRefreshToken: string) {
  let payload: { userId: string }
  try {
    payload = verifyRefreshToken(oldRefreshToken) as { userId: string }
  } catch {
    throw new UnauthorizedError('Refresh token không hợp lệ')
  }

  const { userId } = payload

  if (!(await hasRefreshToken(userId, oldRefreshToken))) {
    await clearAllRefreshTokens(userId)
    throw new UnauthorizedError('Refresh token đã hết hạn hoặc không hợp lệ')
  }

  const user = await User.findById(userId)
  if (!user || !user.isActive) throw new UnauthorizedError('Tài khoản không tồn tại')

  await removeRefreshToken(userId, oldRefreshToken)

  const accessToken = signAccessToken({ userId, roles: user.roles })
  const newRefreshToken = signRefreshToken({ userId })
  await addRefreshToken(userId, newRefreshToken)

  return { accessToken, refreshToken: newRefreshToken }
}

// ── Logout ────────────────────────────────────────────────────────────────────
export async function logoutUser(refreshToken: string) {
  try {
    const payload = verifyRefreshToken(refreshToken) as { userId: string }
    await removeRefreshToken(payload.userId, refreshToken)
  } catch {
    // token invalid — không cần làm gì
  }
}

// ── Get Me ────────────────────────────────────────────────────────────────────
export async function getMe(userId: string) {
  const [user, store] = await Promise.all([
    User.findById(userId).select('-passwordHash -fcmTokens').lean(),
    Store.findOne({ ownerId: userId }).select('_id').lean(),
  ])
  if (!user) throw new NotFoundError('User không tồn tại')
  return { ...user, storeId: store?._id?.toString() ?? null }
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
  if (!user) throw new NotFoundError('User không tồn tại')

  const valid = await bcrypt.compare(oldPassword, user.passwordHash)
  if (!valid) throw new UnauthorizedError('Mật khẩu hiện tại không đúng')

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await User.findByIdAndUpdate(userId, { passwordHash })

  // Force logout tất cả thiết bị (spec B-10)
  await clearAllRefreshTokens(userId)
}

// ── Admin reset password ──────────────────────────────────────────────────────
export async function adminResetPassword(targetUserId: string): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const newPassword = Array.from({ length: 12 }, () =>
    chars[Math.floor(Math.random() * chars.length)],
  ).join('')

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  await User.findByIdAndUpdate(targetUserId, { passwordHash })
  await clearAllRefreshTokens(targetUserId)

  return newPassword
}
