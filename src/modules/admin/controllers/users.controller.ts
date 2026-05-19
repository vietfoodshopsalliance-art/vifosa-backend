import { FastifyRequest, FastifyReply } from 'fastify';
import { UserModel } from '../../users/user.model.js';

export async function listUsers(req: FastifyRequest, reply: FastifyReply) {
  const { search, limit = '20', cursor } = req.query as any;
  const pageSize = Math.min(Number(limit) || 20, 100);
  const query: Record<string, any> = {};
  if (search) query.$or = [{ username: { $regex: search, $options: 'i' } }, { email: { $regex: search, $options: 'i' } }];
  if (cursor) query._id = { $lt: cursor };
  const users = await UserModel.find(query).sort({ _id: -1 }).limit(pageSize + 1).select('-passwordHash').lean();
  const hasMore = users.length > pageSize;
  const items = users.slice(0, pageSize);
  return reply.send({ users: items, nextCursor: hasMore ? String(items[items.length - 1]._id) : undefined });
}

export async function getUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const user = await UserModel.findById(id).select('-passwordHash').lean();
  if (!user) return reply.code(404).send({ error: 'Not found' });
  return reply.send(user);
}

export async function suspendUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const { suspended } = req.body as any;
  const user = await UserModel.findByIdAndUpdate(id, { $set: { isActive: !suspended } }, { new: true }).select('-passwordHash');
  if (!user) return reply.code(404).send({ error: 'Not found' });
  return reply.send(user);
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  return reply.code(501).send({ error: 'Not implemented' });
}

export async function updateRoles(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const { roles } = req.body as any;
  const user = await UserModel.findByIdAndUpdate(id, { $set: { roles } }, { new: true }).select('-passwordHash');
  if (!user) return reply.code(404).send({ error: 'Not found' });
  return reply.send(user);
}

export async function deleteUser(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as any;
  const user = await UserModel.findByIdAndDelete(id);
  if (!user) return reply.code(404).send({ error: 'Not found' });
  return reply.send({ ok: true });
}

export async function getUserAuditLog(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ logs: [] });
}
