// backend/src/modules/auth/auth.service.ts
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { UserModel } from '../users/user.model.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../../utils/jwt.js';
import type { RegisterInput, LoginInput } from './auth.schema.js';

const BCRYPT_ROUNDS = 12;

// ─── Lưu refresh token: dùng Set trong memory (MVP) ────────────────────────
// Phase 2: chuyển sang Redis / lưu DB với tokenVersion
export const refreshTokenStore = new Set<string>();
export function clearRefreshTokenStore() { refreshTokenStore.clear(); }

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateTempPassword(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12); // 12 ký tự alphanumeric
}

// Nhận dạng identifier là username / email / phone
function detectIdentifierType(identifier: string) {
  if (identifier.includes('@')) return 'email';
  if (/^0\d{9}$/.test(identifier)) return 'phone';
  return 'username';
}

// ─── Register ───────────────────────────────────────────────────────────────

export async function registerUser(
  input: RegisterInput,
  meta: { ip: string; tosVersion: string }
) {
  // Kiểm tra trùng lặp
  const existing = await UserModel.findOne({
    $or: [
      { username: input.username },
      { email: input.email },
      { phone: input.phone },
    ],
  });

  if (existing) {
    if (existing.username === input.username) throw new ConflictError('Username đã được sử dụng');
    if (existing.email === input.email) throw new ConflictError('Email đã được sử dụng');
    if (existing.phone === input.phone) throw new ConflictError('Số điện thoại đã được sử dụng');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const user = await UserModel.create({
    username: input.username,
    nickname: input.nickname,
    email: input.email,
    phone: input.phone,
    passwordHash,
    roles: ['customer'],
    tosAcceptedAt: new Date(),
    tosVersion: meta.tosVersion,
  });

  const tokens = issueTokenPair(user._id.toString(), user.roles);
  return { user: sanitizeUser(user), ...tokens };
}

// ─── Login ──────────────────────────────────────────────────────────────────

export async function loginUser(input: LoginInput) {
  const identifierType = detectIdentifierType(input.identifier);

  const query =
    identifierType === 'email'
      ? { email: input.identifier.toLowerCase() }
      : identifierType === 'phone'
      ? { phone: input.identifier }
      : { username: input.identifier.toLowerCase() };

  const user = await UserModel.findOne(query);
  if (!user) throw new UnauthorizedError('Sai thông tin đăng nhập');

  if (!user.isActive) throw new ForbiddenError('Tài khoản đã bị khoá. Liên hệ hỗ trợ.');

  const passwordMatch = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatch) throw new UnauthorizedError('Sai thông tin đăng nhập');

  const tokens = issueTokenPair(user._id.toString(), user.roles);
  return { user: sanitizeUser(user), ...tokens };
}

// ─── Refresh token ───────────────────────────────────────────────────────────

export async function refreshTokens(rawRefreshToken: string) {
  if (!refreshTokenStore.has(rawRefreshToken)) {
    throw new UnauthorizedError('Refresh token không hợp lệ hoặc đã được dùng');
  }

  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    refreshTokenStore.delete(rawRefreshToken);
    throw new UnauthorizedError('Refresh token hết hạn');
  }

  const user = await UserModel.findById(payload.userId);
  if (!user || !user.isActive) throw new UnauthorizedError('Tài khoản không tồn tại hoặc đã bị khoá');

  // Rotate: xoá token cũ, cấp token mới
  refreshTokenStore.delete(rawRefreshToken);
  const tokens = issueTokenPair(user._id.toString(), user.roles);
  return { user: sanitizeUser(user), ...tokens };
}

// ─── Logout ──────────────────────────────────────────────────────────────────

export async function logoutUser(refreshToken: string) {
  refreshTokenStore.delete(refreshToken);
}

// ─── FCM token ───────────────────────────────────────────────────────────────

export async function saveFcmToken(userId: string, fcmToken: string) {
  await UserModel.findByIdAndUpdate(userId, {
    $addToSet: { fcmTokens: fcmToken },
  });
}

export async function removeFcmToken(userId: string, fcmToken: string) {
  await UserModel.findByIdAndUpdate(userId, {
    $pull: { fcmTokens: fcmToken },
  });
}

// ─── Admin: reset password ───────────────────────────────────────────────────

export async function adminResetPassword(targetUserId: string) {
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

  // Đổi password → force logout tất cả thiết bị (xoá hết refresh tokens của user)
  // MVP: chỉ revoke token trong memory store (do scope userId không lưu trong token)
  // Phase 2: lưu refreshTokens array trong DB và clear ở đây
  await UserModel.findByIdAndUpdate(targetUserId, { passwordHash });

  return { tempPassword }; // Admin tự truyền cho user qua kênh ngoài (Zalo/email)
}

// ─── Get me ───────────────────────────────────────────────────────────────────

export async function getMe(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw new NotFoundError('Người dùng không tồn tại');
  return sanitizeUser(user);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function issueTokenPair(userId: string, roles: string[]) {
  const accessToken = signAccessToken({ userId, roles });
  const refreshToken = signRefreshToken({ userId });
  refreshTokenStore.add(refreshToken);
  return { accessToken, refreshToken };
}

// Không trả passwordHash ra ngoài bao giờ
function sanitizeUser(user: any) {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.passwordHash;
  delete obj.fcmTokens; // không cần trả về client
  return obj;
}

// ─── Custom errors ────────────────────────────────────────────────────────────

export class ConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'ConflictError'; }
}
export class UnauthorizedError extends Error {
  constructor(message: string) { super(message); this.name = 'UnauthorizedError'; }
}
export class ForbiddenError extends Error {
  constructor(message: string) { super(message); this.name = 'ForbiddenError'; }
}
export class NotFoundError extends Error {
  constructor(message: string) { super(message); this.name = 'NotFoundError'; }
}