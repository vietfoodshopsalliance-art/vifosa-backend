import { FastifyRequest, FastifyReply } from 'fastify';

export async function getSettings(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ settings: {} });
}

export async function updateSettings(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ ok: true });
}
