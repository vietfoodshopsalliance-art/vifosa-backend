import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

// Access token payload — chỉ chứa sub (userId). Roles được lấy fresh từ DB trong requireAuth.
export interface JwtAccessPayload {
  sub: string
}

// Refresh token payload — sub + jti (UUID) để lookup O(1) trong refresh_tokens collection.
export interface JwtRefreshPayload {
  sub: string
  jti: string
}

function accessSecret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return s
}

function refreshSecret() {
  const s = process.env.JWT_REFRESH_SECRET
  if (!s) throw new Error('JWT_REFRESH_SECRET is not set')
  return s
}

const ACCESS_EXPIRES = () => process.env.JWT_ACCESS_EXPIRES ?? '15m'
const REFRESH_EXPIRES = () => process.env.JWT_REFRESH_EXPIRES ?? '30d'

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, accessSecret(), {
    expiresIn: ACCESS_EXPIRES(),
  } as jwt.SignOptions)
}

export function signRefreshToken(userId: string): { token: string; jti: string } {
  const jti = crypto.randomUUID()
  const token = jwt.sign({ sub: userId, jti }, refreshSecret(), {
    expiresIn: REFRESH_EXPIRES(),
  } as jwt.SignOptions)
  return { token, jti }
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  return jwt.verify(token, accessSecret()) as JwtAccessPayload
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  return jwt.verify(token, refreshSecret()) as JwtRefreshPayload
}
