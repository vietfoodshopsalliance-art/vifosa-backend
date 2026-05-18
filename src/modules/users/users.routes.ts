import { Address } from '../db';
import { requireAuth } from '../../middleware/auth.middleware.js';
import mongoose from 'mongoose';

export async function usersRoutes(fastify: FastifyInstance) {


  // PATCH /me
  fastify.patch('/me', { preHandler: requireAuth }, async (request, reply) => {
    const User = (mongoose.models['User'] as any) || mongoose.model('User');
    const userId = (request as any).user.userId;
    const body = request.body as any;

    if (body.username !== undefined) {
      return reply.status(400).send({ error: 'username cannot be changed' });
    }

    const allowed: any = {};
    if (body.nickname !== undefined) allowed.nickname = body.nickname;
    if (body.avatar !== undefined) allowed.avatar = body.avatar;

    const updated = await User.findByIdAndUpdate(userId, { $set: allowed }, { new: true }).select(
      '-password -refreshTokens'
    );
    return reply.send({ user: updated });
  });

  // POST /me/avatar
  fastify.post('/me/avatar', { preHandler: requireAuth }, async (request, reply) => {
    const User = (mongoose.models['User'] as any) || mongoose.model('User');
    const userId = (request as any).user.userId;
    const { avatarUrl } = request.body as any;

    if (!avatarUrl) return reply.status(400).send({ error: 'avatarUrl required' });

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: { avatar: avatarUrl } },
      { new: true }
    ).select('-password -refreshTokens');
    return reply.send({ user: updated });
  });

  // GET /users/:username (public)
  fastify.get('/users/:username', async (request, reply) => {
    const User = (mongoose.models['User'] as any) || mongoose.model('User');
    const { username } = request.params as any;
    const user = await User.findOne({ username }).select(
      'username nickname avatar roles createdAt'
    );
    if (!user) return reply.status(404).send({ error: 'User not found' });
    return reply.send({ user });
  });

  // GET /me/addresses
  fastify.get('/me/addresses', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const addresses = await Address.find({ userId }).sort({ isDefault: -1, createdAt: 1 });
    return reply.send({ addresses });
  });

  // POST /me/addresses
  fastify.post('/me/addresses', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const body = request.body as any;

    const count = await Address.countDocuments({ userId });
    const isDefault = count === 0 ? true : !!body.isDefault;

    if (isDefault) {
      await Address.updateMany({ userId }, { $set: { isDefault: false } });
    }

    const addr = await Address.create({
      userId,
      label: body.label,
      address: body.address,
      receiver: body.receiver,
      isDefault,
    });
    return reply.status(201).send({ address: addr });
  });

  // PATCH /me/addresses/:id
  fastify.patch('/me/addresses/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const { id } = request.params as any;
    const body = request.body as any;

    const addr = await Address.findOne({ _id: id, userId });
    if (!addr) return reply.status(404).send({ error: 'Address not found' });

    const allowed: any = {};
    if (body.label !== undefined) allowed.label = body.label;
    if (body.address !== undefined) allowed.address = body.address;
    if (body.receiver !== undefined) allowed.receiver = body.receiver;

    const updated = await Address.findByIdAndUpdate(id, { $set: allowed }, { new: true });
    return reply.send({ address: updated });
  });

  // DELETE /me/addresses/:id
  fastify.delete('/me/addresses/:id', { preHandler: requireAuth }, async (request, reply) => {
    const userId = (request as any).user.userId;
    const { id } = request.params as any;

    const addr = await Address.findOne({ _id: id, userId });
    if (!addr) return reply.status(404).send({ error: 'Address not found' });

    await addr.deleteOne();
    // If deleted was default, set first remaining as default
    if (addr.isDefault) {
      const first = await Address.findOne({ userId }).sort({ createdAt: 1 });
      if (first) await Address.findByIdAndUpdate(first._id, { $set: { isDefault: true } });
    }
    return reply.status(204).send();
  });

  // PATCH /me/addresses/:id/default
  fastify.patch(
    '/me/addresses/:id/default',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = (request as any).user.userId;
      const { id } = request.params as any;

      const addr = await Address.findOne({ _id: id, userId });
      if (!addr) return reply.status(404).send({ error: 'Address not found' });

      await Address.updateMany({ userId }, { $set: { isDefault: false } });
      await Address.findByIdAndUpdate(id, { $set: { isDefault: true } });
      return reply.send({ ok: true });
    }
  );
// GET /me — trả về user trực tiếp (không wrap) để web và mobile đọc được me.roles, me.storeId
fastify.get('/me', { preHandler: requireAuth }, async (request, reply) => {
  const { getMe } = await import('../auth/auth.service.js');
  const userId = (request as any).user.userId;
  const user = await getMe(userId);
  return reply.send(user);
});


// POST /me/change-password
fastify.post('/me/change-password', { preHandler: requireAuth }, async (request, reply) => {
  const bcrypt = (await import('bcrypt')).default;
  const User = (mongoose.models['User'] as any) || mongoose.model('User');
  const u = (request as any).user;
  const userId = u.userId ?? u._id;
  const { oldPassword, newPassword } = request.body as any;
  if (!oldPassword || !newPassword) return reply.status(400).send({ error: 'Thiếu oldPassword hoặc newPassword' });
  if (newPassword.length < 8) return reply.status(400).send({ error: 'newPassword phải ít nhất 8 ký tự' });
  const user = await User.findById(userId);
  if (!user) return reply.status(404).send({ error: 'User not found' });
  const valid = await bcrypt.compare(oldPassword, (user as any).passwordHash);
  if (!valid) return reply.status(401).send({ error: 'Mật khẩu hiện tại không đúng' });
  const hash = await bcrypt.hash(newPassword, 12);
  await User.findByIdAndUpdate(userId, { passwordHash: hash });
  // Force logout tất cả thiết bị — xoá in-memory store
  const { clearAllRefreshTokens } = await import('../auth/auth.service.js');
  clearAllRefreshTokens(userId.toString());
  return reply.send({ success: true, message: 'Đổi mật khẩu thành công' });
});


// POST /tos/accept
fastify.post('/tos/accept', { preHandler: requireAuth }, async (request, reply) => {
  const User = (mongoose.models['User'] as any) || mongoose.model('User');
  const userId = (request as any).user.userId;
  const { version = '1.0' } = request.body as any;
  await User.findByIdAndUpdate(userId, {
    $set: { tosAccepted: true, tosVersion: version, tosAcceptedAt: new Date() },
  });
  return reply.send({ ok: true });
});

}