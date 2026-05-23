import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { Like, MenuItem, Store } from '../db/index.js';
import mongoose from 'mongoose';


export async function socialRoutes(app: FastifyInstance) {

  // POST /likes
  app.post('/likes', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const { type, targetId } = request.body as any;

    if (!['store', 'item'].includes(type)) {
      return reply.status(400).send({ error: 'type phải là store hoặc item' });
    }
    if (!mongoose.isValidObjectId(targetId)) {
      return reply.status(400).send({ error: 'targetId không hợp lệ' });
    }

    const existing = await Like.findOne({ userId, targetType: type, targetId });
    if (existing) {
      return reply.send({ id: (existing._id as any).toString() });
    }

    const like = await Like.create({ userId, targetType: type, targetId });
    return reply.status(201).send({ id: (like._id as any).toString() });
  });

  // GET /me/favorites/stores
  app.get('/me/favorites/stores', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).user.userId;

    const likes = await Like.find({ userId, targetType: 'store' });
    if (likes.length === 0) return reply.send({ stores: [] });

    const storeIds = likes.map(l => l.targetId);
    const likeMap = new Map(likes.map(l => [l.targetId.toString(), (l._id as any).toString()]));

    const stores = await Store.find({ _id: { $in: storeIds }, isDeleted: { $ne: true } }).lean();

    const result = (stores as any[]).map(s => ({
      ...s,
      _id: s._id.toString(),
      likeId: likeMap.get(s._id.toString()),
    }));

    return reply.send({ stores: result });
  });

  // GET /me/favorites/items
  app.get('/me/favorites/items', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).user.userId;

    const likes = await Like.find({ userId, targetType: 'item' });
    if (likes.length === 0) return reply.send({ items: [] });

    const itemIds = likes.map(l => l.targetId);
    const likeMap = new Map(likes.map(l => [l.targetId.toString(), (l._id as any).toString()]));

    const items = await MenuItem.find({ _id: { $in: itemIds }, isDeleted: false }).lean();

    // Batch-load store names
    const storeIdSet = new Set(
      (items as any[]).map((item: any) => item.storeId?.toString()).filter(Boolean)
    );
    const storeList = await Store.find({ _id: { $in: [...storeIdSet] } }).select('name').lean();
    const storeNameMap = new Map((storeList as any[]).map(s => [s._id.toString(), s.name as string]));

    const result = (items as any[]).map((item: any) => ({
      ...item,
      _id: item._id.toString(),
      storeId: item.storeId?.toString() ?? '',
      storeName: storeNameMap.get(item.storeId?.toString()) ?? '',
      imageUrl: (item.images as string[])?.[0] ?? null,
      likeId: likeMap.get(item._id.toString()),
    }));

    return reply.send({ items: result });
  });

  // DELETE /likes/:id
  app.delete('/likes/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const { id } = request.params as any;

    if (!mongoose.isValidObjectId(id)) {
      return reply.status(400).send({ error: 'ID không hợp lệ' });
    }

    const like = await Like.findOneAndDelete({ _id: id, userId });
    if (!like) return reply.status(404).send({ error: 'Không tìm thấy' });

    return reply.status(204).send();
  });
}
