import { FastifyInstance } from 'fastify';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { SupportTicket } from '../db/index.js';

export async function supportRoutes(app: FastifyInstance) {
  // POST /support/tickets — tạo ticket (logged-in user)
  app.post<{
    Body: { subject: string; body: string; images?: string[]; relatedOrderCode?: string }
  }>(
    '/support/tickets',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.user!.userId;
      const { subject, body, images, relatedOrderCode } = req.body;

      if (!subject?.trim()) return reply.code(400).send({ error: 'Tiêu đề là bắt buộc' });
      if (!body?.trim()) return reply.code(400).send({ error: 'Nội dung là bắt buộc' });

      const ticket = await SupportTicket.create({
        userId,
        subject: subject.trim(),
        body: body.trim(),
        images: images ?? [],
        relatedOrderCode: relatedOrderCode?.trim() || null,
        status: 'open',
      });

      return reply.code(201).send({ ticket });
    }
  );

  // GET /me/support/tickets — lịch sử ticket của user
  app.get<{ Querystring: { page?: string; limit?: string } }>(
    '/me/support/tickets',
    { preHandler: requireAuth },
    async (req, reply) => {
      const userId = req.user!.userId;
      const page  = Math.max(1, parseInt(req.query.page  ?? '1'));
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit ?? '20')));

      const [tickets, total] = await Promise.all([
        SupportTicket.find({ userId })
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        SupportTicket.countDocuments({ userId }),
      ]);

      return reply.send({ tickets, total, page, limit });
    }
  );
}
