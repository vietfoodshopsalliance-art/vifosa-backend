import { FastifyRequest, FastifyReply } from 'fastify';
import { SupportTicket } from '../../db/misc.model.js';

export async function listTickets(
  req: FastifyRequest<{ Querystring: { status?: string; limit?: string } }>,
  reply: FastifyReply
) {
  const allowed = ['open', 'replied', 'closed'] as const;
  type TicketStatus = typeof allowed[number];
  const rawStatus = req.query.status ?? 'open';
  const status: TicketStatus = (allowed as readonly string[]).includes(rawStatus) ? rawStatus as TicketStatus : 'open';
  const limit  = Math.min(parseInt(req.query.limit ?? '20', 10) || 20, 100);

  const tickets = await SupportTicket.find({ status })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return reply.send({ tickets });
}

export async function getTicket(
  req: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  const ticket = await SupportTicket.findById(req.params.id).lean();
  if (!ticket) return reply.code(404).send({ error: 'Không tìm thấy ticket' });
  return reply.send({ ticket });
}

export async function replyTicket(
  req: FastifyRequest<{ Params: { id: string }; Body: { adminReply?: string; status?: string } }>,
  reply: FastifyReply
) {
  const { adminReply, status } = req.body ?? {};

  const update: Record<string, any> = {};
  if (status) update.status = status;
  if (adminReply !== undefined) {
    update.adminReply = adminReply;
    if (status === 'replied') update.repliedAt = new Date();
  }

  const ticket = await SupportTicket.findByIdAndUpdate(
    req.params.id,
    { $set: update },
    { new: true, lean: true }
  );
  if (!ticket) return reply.code(404).send({ error: 'Không tìm thấy ticket' });

  return reply.send({ ok: true, ticket });
}

export async function listAuditLog(req: FastifyRequest, reply: FastifyReply) {
  return reply.send({ logs: [] });
}
