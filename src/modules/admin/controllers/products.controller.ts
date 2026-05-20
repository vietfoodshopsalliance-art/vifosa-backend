import { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { MenuItem } from '../../db/menu.model.js';
import { Order } from '../../db/orders.model.js';

const SORT_MAP: Record<string, string> = {
  name: 'name',
  price: 'price',
  status: 'status',
  stock: 'stock',
  soldAllTime: 'soldCount.allTime',
  sold30d: 'soldCount.last30d',
  storeName: 'storeName',
};

const LOOKUP_STORE = {
  $lookup: {
    from: 'stores',
    localField: 'storeId',
    foreignField: '_id',
    as: '_store',
  },
};
const ADD_STORE_NAME = {
  $addFields: { storeName: { $arrayElemAt: ['$_store.name', 0] } },
};
const PROJECT_STORE = { $project: { _store: 0 } };

async function attachSoldCounts(items: any[]) {
  if (items.length === 0) return;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const itemIds = items.map((i) => i._id);

  const soldData = await Order.aggregate([
    { $match: { mainStatus: 'completed', 'items.itemId': { $in: itemIds } } },
    { $unwind: '$items' },
    { $match: { 'items.itemId': { $in: itemIds } } },
    {
      $group: {
        _id: '$items.itemId',
        allTime: { $sum: '$items.qty' },
        last30d: {
          $sum: { $cond: [{ $gte: ['$createdAt', thirtyDaysAgo] }, '$items.qty', 0] },
        },
      },
    },
  ]);

  const soldMap = new Map(soldData.map((x: any) => [String(x._id), x]));
  for (const item of items) {
    const s = soldMap.get(String(item._id));
    item.soldCount = { allTime: s?.allTime ?? 0, last30d: s?.last30d ?? 0 };
  }
}

export async function listProducts(req: FastifyRequest, reply: FastifyReply) {
  const { search, status, storeId, limit = '50', cursor, sortBy, sortDir } = req.query as any;
  const pageSize = Math.min(Number(limit) || 50, 200);

  // soldCount.allTime / sold30d sort phải dùng giá trị real-time nên không hỗ trợ server-sort
  const isSorted = !!(sortBy && SORT_MAP[sortBy] && sortBy !== 'soldAllTime' && sortBy !== 'sold30d');
  const sortField = isSorted ? SORT_MAP[sortBy] : '_id';
  const sortOrder: 1 | -1 = sortDir === 'asc' ? 1 : -1;

  const matchStage: Record<string, any> = { isDeleted: false };
  if (search) matchStage.$or = [
    { name: { $regex: search, $options: 'i' } },
    { description: { $regex: search, $options: 'i' } },
  ];
  if (status) matchStage.status = status;
  if (storeId) matchStage.storeId = new mongoose.Types.ObjectId(storeId);
  if (!isSorted && cursor) matchStage._id = { $lt: new mongoose.Types.ObjectId(cursor) };

  let pipeline: any[];

  if (!isSorted) {
    pipeline = [
      { $match: matchStage },
      { $sort: { _id: -1 } },
      { $limit: pageSize + 1 },
      LOOKUP_STORE,
      ADD_STORE_NAME,
      PROJECT_STORE,
    ];
  } else if (sortField === 'storeName') {
    pipeline = [
      { $match: matchStage },
      LOOKUP_STORE,
      ADD_STORE_NAME,
      PROJECT_STORE,
      { $sort: { storeName: sortOrder, _id: -1 } },
      { $limit: pageSize },
    ];
  } else {
    pipeline = [
      { $match: matchStage },
      { $sort: { [sortField]: sortOrder, _id: -1 } },
      { $limit: pageSize },
      LOOKUP_STORE,
      ADD_STORE_NAME,
      PROJECT_STORE,
    ];
  }

  const items = await MenuItem.aggregate(pipeline);

  if (isSorted) {
    await attachSoldCounts(items);
    return reply.send({ items, nextCursor: undefined });
  }

  const hasMore = items.length > pageSize;
  const page = items.slice(0, pageSize);
  await attachSoldCounts(page);
  return reply.send({
    items: page,
    nextCursor: hasMore ? String(page[page.length - 1]._id) : undefined,
  });
}
