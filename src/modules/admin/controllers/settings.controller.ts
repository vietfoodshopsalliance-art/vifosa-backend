import { FastifyRequest, FastifyReply } from 'fastify';
import { Setting } from '../../db/misc.model.js';

const ALLOWED_PUBLIC_KEYS = new Set(['privacy_content', 'tos_content']);

export async function getSettings(_req: FastifyRequest, reply: FastifyReply) {
  const settings = await Setting.find({}).lean();
  return reply.send({ settings });
}

export async function updateSettings(
  req: FastifyRequest<{ Body: Record<string, any> }>,
  reply: FastifyReply,
) {
  const user = (req as any).user;
  const updates = req.body ?? {};
  await Promise.all(
    Object.entries(updates).map(([key, value]) =>
      Setting.findOneAndUpdate(
        { key },
        { $set: { value, updatedBy: user?.sub ?? null } },
        { upsert: true, new: true },
      ),
    ),
  );
  return reply.send({ ok: true });
}

export async function getSetting(
  req: FastifyRequest<{ Params: { key: string } }>,
  reply: FastifyReply,
) {
  const { key } = req.params;
  const doc = await Setting.findOne({ key }).lean();
  if (!doc) return reply.status(404).send({ error: 'Không tìm thấy setting' });
  return reply.send({ value: doc.value, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy });
}

export async function upsertSetting(
  req: FastifyRequest<{ Params: { key: string }; Body: { value: any } }>,
  reply: FastifyReply,
) {
  const { key } = req.params;
  const { value } = req.body;
  const user = (req as any).user;
  const doc = await Setting.findOneAndUpdate(
    { key },
    { $set: { value, updatedBy: user?.sub ?? null } },
    { upsert: true, new: true },
  ).lean();
  return reply.send({ value: doc!.value, updatedAt: doc!.updatedAt, updatedBy: doc!.updatedBy });
}

export async function getPublicSetting(
  req: FastifyRequest<{ Params: { key: string } }>,
  reply: FastifyReply,
) {
  const { key } = req.params;
  if (!ALLOWED_PUBLIC_KEYS.has(key)) {
    return reply.status(404).send({ error: 'Không tìm thấy' });
  }
  const doc = await Setting.findOne({ key }).lean();
  if (!doc) return reply.status(404).send({ error: 'Nội dung đang được cập nhật' });
  return reply.send({ value: doc.value, updatedAt: doc.updatedAt });
}
