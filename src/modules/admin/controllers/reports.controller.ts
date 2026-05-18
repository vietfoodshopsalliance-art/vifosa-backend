import { FastifyRequest, FastifyReply } from 'fastify';

export async function listReports(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ reports: [] });
}

export async function getReport(req: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({ error: 'Not found' });
}

export async function updateStatus(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ ok: true });
}

export async function hideTarget(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ ok: true });
}

export async function restoreTarget(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ ok: true });
}
