import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

export interface JwtAccessPayload {
  userId: string
  roles: string[]
}

export interface JwtRefreshPayload {
  userId: string
  tokenVersion?: number
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

export function signAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, accessSecret(), { expiresIn: ACCESS_EXPIRES() } as jwt.SignOptions)
}

export function signRefreshToken(payload: JwtRefreshPayload): string {
  return jwt.sign(
    { ...payload, jti: crypto.randomUUID() },
    refreshSecret(),
    { expiresIn: REFRESH_EXPIRES() } as jwt.SignOptions,
  )
}

export function verifyAccessToken(token: string): JwtAccessPayload {
  return jwt.verify(token, accessSecret()) as JwtAccessPayload
}

export function verifyRefreshToken(token: string): JwtRefreshPayload {
  return jwt.verify(token, refreshSecret()) as JwtRefreshPayload
}
