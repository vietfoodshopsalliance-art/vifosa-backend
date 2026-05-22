import type { FastifyInstance } from 'fastify';
import { Address } from '../db/index.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import mongoose from 'mongoose';

export async function usersRoutes(fastify: FastifyInstance) {


  // PATCH /me — sửa thông tin cá nhân được phép
  fastify.patch('/me', { preHandler: requireAuth }, async (request, reply) => {
    const User = (mongoose.models['User'] as any) || mongoose.model('User');
    const userId = (request as any).user.userId;
    const body = request.body as any;

    if (body.username !== undefined) {
      return reply.status(400).send({ error: 'username không thể thay đổi' });
    }

    const VALID_PAYMENT_METHODS = ['bankTransfer', 'cod', 'fiftyFifty', 'momo', 'zaloPay'];
    const allowed: any = {};
    if (body.nickname !== undefined) allowed.nickname = body.nickname;
    if (body.avatar !== undefined) allowed.avatar = body.avatar;
    if (body.defaultPaymentMethod !== undefined) {
      if (body.defaultPaymentMethod !== null && !VALID_PAYMENT_METHODS.includes(body.defaultPaymentMethod)) {
        return reply.status(400).send({ error: 'defaultPaymentMethod không hợp lệ' });
      }
      allowed.defaultPaymentMethod = body.defaultPaymentMethod;
    }

    if (Object.keys(allowed).length === 0) {
      return reply.status(400).send({ error: 'Không có field nào được cập nhật' });
    }

    const updated = await User.findByIdAndUpdate(userId, { $set: allowed }, { new: true }).select(
      '-passwordHash -fcmTokens'
    );
    return reply.send({ user: updated });
  });

  // PATCH /me/bank-account — lưu TK ngân hàng nhận hoàn tiền
  fastify.patch('/me/bank-account', { preHandler: requireAuth }, async (request, reply) => {
    const User = (mongoose.models['User'] as any) || mongoose.model('User');
    const userId = (request as any).user.userId;
    const body = request.body as any;

    const { bank, number, holder } = body;
    if (!bank?.trim() || !number?.trim() || !holder?.trim()) {
      return reply.status(400).send({ error: 'bank, number, holder là bắt buộc' });
    }
    if (number.trim().length < 6) {
      return reply.status(400).send({ error: 'Số tài khoản không hợp lệ' });
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      {
        $set: {
          bankAccountForRefund: {
            bank: bank.trim(),
            number: number.trim(),
            holder: holder.trim().toUpperCase(),
          },
        },
      },
      { new: true }
    ).select('-passwordHash -fcmTokens');

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
    ).select('-passwordHash -fcmTokens');
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


// POST /me/change-password  (alias cho PUT /me/password theo spec)
fastify.post('/me/change-password', { preHandler: requireAuth }, async (request, reply) => {
  const { changePassword } = await import('../auth/auth.controller.js');
  return changePassword(request, reply);
});


// POST /me/fcm-token
fastify.post('/me/fcm-token', { preHandler: requireAuth }, async (request, reply) => {
  const { addFcmToken } = await import('../auth/auth.controller.js');
  return addFcmToken(request, reply);
});

// DELETE /me/fcm-token
fastify.delete('/me/fcm-token', { preHandler: requireAuth }, async (request, reply) => {
  const { removeFcmToken } = await import('../auth/auth.controller.js');
  return removeFcmToken(request, reply);
});

// GET /me/reviews — đánh giá người khác viết về mình (store → customer)
fastify.get('/me/reviews', { preHandler: requireAuth }, async (request, reply) => {
  const { Review } = await import('../db/index.js');
  const userId = (request as any).user.userId;
  const page  = Math.max(1, parseInt((request.query as any).page  ?? '1'));
  const limit = Math.min(50, Math.max(1, parseInt((request.query as any).limit ?? '20')));

  const filter = { toEntityId: new (await import('mongoose')).default.Types.ObjectId(userId), toEntityType: 'customer' as const, isHiddenByAdmin: false };
  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate('fromUserId', 'nickname avatar')
      .populate('orderId', 'code')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Review.countDocuments(filter),
  ]);

  const avgStars = reviews.length
    ? reviews.reduce((s, r) => s + r.stars, 0) / reviews.length
    : null;

  return reply.send({ reviews, total, page, limit, avgStars });
});

// GET /me/reviews-given — review tôi đã viết cho quán
fastify.get('/me/reviews-given', { preHandler: requireAuth }, async (request, reply) => {
  const { Review } = await import('../db/index.js');
  const userId = (request as any).user.userId;
  const page  = Math.max(1, parseInt((request.query as any).page  ?? '1'));
  const limit = Math.min(50, Math.max(1, parseInt((request.query as any).limit ?? '20')));

  const filter = { fromUserId: new (await import('mongoose')).default.Types.ObjectId(userId), toEntityType: 'store' as const };
  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .populate('toEntityId', 'name avatarImage')
      .populate('orderId', 'code')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Review.countDocuments(filter),
  ]);

  return reply.send({ reviews, total, page, limit });
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