import { FastifyRequest, FastifyReply } from 'fastify';
import { MenuItem } from '../../db/menu.model.js';

export async function listProducts(req: FastifyRequest, reply: FastifyReply) {
  const { search, status, storeId, limit = '50', cursor } = req.query as any;
  const pageSize = Math.min(Number(limit) || 50, 200);

  const query: Record<string, any> = { isDeleted: false };
  if (search) query.$or = [
    { name: { $regex: search, $options: 'i' } },
    { description: { $regex: search, $options: 'i' } },
  ];
  if (status) query.status = status;
  if (storeId) query.storeId = storeId;
  if (cursor) query._id = { $lt: cursor };

  const items = await MenuItem.find(query)
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .lean();

  const hasMore = items.length > pageSize;
  const page = items.slice(0, pageSize);
  return reply.send({
    items: page,
    nextCursor: hasMore ? String(page[page.length - 1]._id) : undefined,
  });
}
