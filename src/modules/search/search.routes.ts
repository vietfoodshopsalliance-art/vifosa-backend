import { FastifyInstance } from 'fastify'
import mongoose from 'mongoose'
import { Store } from '../db/stores.model.js'
import { MenuItem } from '../db/menu.model.js'

// Map từ ký tự base → tất cả biến thể có dấu tiếng Việt
const VIET_MAP: Record<string, string> = {
  a: '[aàáảãạăắặằẳẵâấầẩẫậ]',
  e: '[eèéẻẽẹêếềểễệ]',
  i: '[iìíỉĩị]',
  o: '[oòóỏõọôốồổỗộơớờởỡợ]',
  u: '[uùúủũụưứừửữự]',
  y: '[yỳýỷỹỵ]',
  d: '[dđ]',
}

// Tạo regex từ query, hỗ trợ tìm không dấu khớp có dấu.
// Ví dụ: "banh chuoi" → khớp "bánh chuối", "bành chuôi", ...
function buildVietnameseRegex(query: string): RegExp {
  // NFD tách dấu thành ký tự combining, sau đó strip; đ/Đ phải xử lý riêng
  const base = query
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()

  const pattern = base
    .split('')
    .map(char => VIET_MAP[char] ?? char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('')

  return new RegExp(pattern, 'i')
}

export async function searchRoutes(app: FastifyInstance) {
  // GET /search?q=<query>
  app.get('/search', async (request, reply) => {
    const { q } = request.query as { q?: string }
    const query = (q ?? '').trim()

    if (!query || query.length < 1) {
      return reply.send({ stores: [] })
    }

    const regex = buildVietnameseRegex(query)

    // 1. Stores khớp tên hoặc mô tả
    const matchedStores = await Store.find({
      isSuspended: false,
      $or: [{ name: regex }, { description: regex }],
    })
      .select('_id name description coverImage avatarImage address openingHours emergencyClosed isSuspended isAdLockedByAdmin bankAccount paymentMethods shipFeeFormula autoCancelMinutes stats')
      .limit(15)
      .lean()

    // 2. Menu items khớp tên
    const matchedItems = await MenuItem.find({
      name: regex,
      status: 'active',
      isDeleted: false,
    })
      .select('_id storeId name price')
      .limit(60)
      .lean()

    // Group items by storeId
    const itemsByStore = new Map<string, { name: string; price: number }[]>()
    for (const item of matchedItems) {
      const sid = item.storeId.toString()
      if (!itemsByStore.has(sid)) itemsByStore.set(sid, [])
      itemsByStore.get(sid)!.push({ name: item.name, price: item.price })
    }

    // 3. Load stores có item khớp mà chưa có trong matchedStores
    const alreadyIds = new Set(matchedStores.map((s: any) => s._id.toString()))
    const extraStoreIds = [...itemsByStore.keys()].filter(id => !alreadyIds.has(id))

    let extraStores: any[] = []
    if (extraStoreIds.length > 0) {
      extraStores = await Store.find({
        _id: { $in: extraStoreIds.map(id => new mongoose.Types.ObjectId(id)) },
        isSuspended: false,
      })
        .select('_id name description coverImage avatarImage address openingHours emergencyClosed isSuspended isAdLockedByAdmin bankAccount paymentMethods shipFeeFormula autoCancelMinutes stats')
        .limit(10)
        .lean()
    }

    // 4. Gộp kết quả: stores khớp tên trước, sau đó stores có item khớp
    const results = [
      ...matchedStores.map((store: any) => ({
        store,
        matchedItems: itemsByStore.get(store._id.toString()) ?? [],
      })),
      ...extraStores.map((store: any) => ({
        store,
        matchedItems: itemsByStore.get(store._id.toString()) ?? [],
      })),
    ].slice(0, 20)

    return reply.send({ stores: results })
  })
}
