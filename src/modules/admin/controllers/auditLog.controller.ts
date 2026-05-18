import { FastifyRequest, FastifyReply } from 'fastify';

export async function listTickets(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ tickets: [] });
}

export async function getTicket(req: FastifyRequest, reply: FastifyReply) {
  return reply.code(404).send({ error: 'Not found' });
}

export async function replyTicket(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ ok: true });
}

export async function listAuditLog(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ logs: [] });
}
