import mongoose, { Schema, Document, Model } from 'mongoose'

/**
 * Bộ đếm SKU theo từng chủ quán (ownerId).
 * Mỗi chủ quán có dải 001..999 để cấp cho các món đồng bộ toàn hệ thống.
 * Cấp số bằng findOneAndUpdate($inc, upsert) — atomic, không trùng kể cả khi tạo song song.
 */
export interface ISkuCounter extends Document {
  ownerId: mongoose.Types.ObjectId
  seq: number
}

const SkuCounterSchema = new Schema<ISkuCounter>(
  {
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'ownerId là bắt buộc'],
      unique: true,
    },
    seq: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: false,
    collection: 'sku_counters',
  }
)

export const SkuCounter: Model<ISkuCounter> =
  mongoose.models.SkuCounter || mongoose.model<ISkuCounter>('SkuCounter', SkuCounterSchema)

/**
 * Cấp SKU kế tiếp cho chủ quán, trả về chuỗi 3 ký tự '001'..'999'.
 * Ném lỗi nếu vượt quá 999.
 */
export async function nextSku(ownerId: mongoose.Types.ObjectId | string): Promise<string> {
  const doc = await SkuCounter.findOneAndUpdate(
    { ownerId },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  )
  if (doc.seq > 999) {
    throw new Error('Đã dùng hết dải SKU (001..999) của chủ quán này')
  }
  return String(doc.seq).padStart(3, '0')
}
