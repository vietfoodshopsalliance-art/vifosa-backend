import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IRefreshToken extends Document {
  jti: string                            // UUID in JWT payload — used for O(1) lookup
  userId: mongoose.Types.ObjectId
  tokenHash: string                      // bcrypt hash of raw token, not stored raw
  deviceInfo: {
    userAgent: string
    ip: string
    platform: 'android' | 'web' | 'ios' | 'unknown'
  }
  issuedAt: Date
  expiresAt: Date                        // issuedAt + 30 days
  revokedAt?: Date
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    jti: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    deviceInfo: {
      type: new Schema(
        {
          userAgent: { type: String, default: '' },
          ip: { type: String, default: '' },
          platform: {
            type: String,
            enum: ['android', 'web', 'ios', 'unknown'],
            default: 'unknown',
          },
        },
        { _id: false },
      ),
      default: () => ({ userAgent: '', ip: '', platform: 'unknown' }),
    },
    issuedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { collection: 'refresh_tokens', timestamps: false },
)

RefreshTokenSchema.index({ userId: 1 })
// TTL: MongoDB tự xoá document khi expiresAt < now
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshToken: Model<IRefreshToken> =
  mongoose.models.RefreshToken ||
  mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema)
