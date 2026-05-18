import { FastifyRequest, FastifyReply } from 'fastify';
import { Store } from '../../db/stores.model.js';
import { User } from '../../users/user.model.js';

// GET /admin/stores?search=&filter=&limit=&cursor=
export async function listStores(req: FastifyRequest, reply: FastifyReply) {
  const { search, filter, limit = '20', cursor } = req.query as any;
  const pageSize = Math.min(Number(limit) || 20, 100);

  const query: Record<string, any> = { isDeleted: { $ne: true } };
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
    ];
  }
  if (filter === 'suspended') query.isSuspended = true;
  if (filter === 'locked') query.isAdLockedByAdmin = true;
  if (filter === 'active') { query.isSuspended = false; query.isAdLockedByAdmin = false; }
  if (filter === 'vip') query.vipTier = { $ne: 'none' };
  if (cursor) query._id = { $lt: cursor };

  const stores = await Store.find(query)
    .sort({ _id: -1 })
    .limit(pageSize + 1)
    .populate('ownerId', 'username')
    .lean();

  const hasMore = stores.length > pageSize;
  const items = stores.slice(0, pageSize);

  return reply.send({
    stores: items.map((s: any) => ({
      _id: s._id,
      name: s.name,
      ownerUsername: (s.ownerId as any)?.username ?? '',
      isActive: !s.isSuspended,
      isSuspended: s.isSuspended,
      isAdLockedByAdmin: s.isAdLockedByAdmin,
      ordersThisMonth: s.stats?.completedOrdersThisMonth ?? 0,
      rating: s.stats?.avgRating ?? 0,
      vipTier: s.vipTier,
    })),
    nextCursor: hasMore ? String(items[items.length - 1]._id) : undefined,
  });
}

// GET /admin/stores/:id
export async function getStore(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const store = await Store.findOne({ _id: id, isDeleted: { $ne: true } })
    .populate('ownerId', 'username')
    .lean();
  if (!store) return reply.code(404).send({ error: 'Not found' });
  return reply.send(store);
}

// PATCH /admin/stores/:id  — suspend / unsuspend / lock_ad / unlock_ad / vipTier
export async function updateStore(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const allowed = ['isSuspended', 'isAdLockedByAdmin', 'vipTier', 'menuLocked'];
  const body = req.body as Record<string, any>;
  const update: Record<string, any> = {};
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }
  const store = await Store.findOneAndUpdate(
    { _id: id, isDeleted: { $ne: true } },
    { $set: update },
    { new: true }
  );
  if (!store) return reply.code(404).send({ error: 'Not found' });
  return reply.send(store);
}

// POST /admin/stores/:id/transfer
export async function transferStore(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const { username } = req.body as any;
  const newOwner = await User.findOne({ username });
  if (!newOwner) return reply.code(404).send({ error: 'User not found' });
  const store = await Store.findOneAndUpdate(
    { _id: id, isDeleted: { $ne: true } },
    { $set: { ownerId: newOwner._id } },
    { new: true }
  );
  if (!store) return reply.code(404).send({ error: 'Store not found' });
  return reply.send({ ok: true });
}

// PATCH /admin/stores/:id/override  — admin edits any store field
export async function overrideStore(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const body = req.body as Record<string, any>;
  const store = await Store.findOneAndUpdate(
    { _id: id, isDeleted: { $ne: true } },
    { $set: body },
    { new: true }
  );
  if (!store) return reply.code(404).send({ error: 'Not found' });
  return reply.send(store);
}

// DELETE /admin/stores/:id  — soft delete
export async function deleteStore(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const store = await Store.findOneAndUpdate(
    { _id: id, isDeleted: { $ne: true } },
    { $set: { isDeleted: true, isSuspended: true } },
    { new: true }
  );
  if (!store) return reply.code(404).send({ error: 'Not found' });
  return reply.send({ ok: true });
}

// POST /admin/stores/bulk
export async function bulkAction(req: FastifyRequest, reply: FastifyReply) {
  const { ids, action } = req.body as { ids: string[]; action: string };
  if (!ids?.length) return reply.code(400).send({ error: 'ids required' });

  const filter = { _id: { $in: ids }, isDeleted: { $ne: true } };

  const actionMap: Record<string, Record<string, any>> = {
    lock_ad:   { isAdLockedByAdmin: true },
    unlock_ad: { isAdLockedByAdmin: false },
    suspend:   { isSuspended: true },
    unsuspend: { isSuspended: false },
    delete:    { isDeleted: true, isSuspended: true },
  };

  const update = actionMap[action];
  if (!update) return reply.code(400).send({ error: `Unknown action: ${action}` });

  await Store.updateMany(filter, { $set: update });
  return reply.send({ ok: true, count: ids.length });
}
