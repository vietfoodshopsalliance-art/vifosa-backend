import { FastifyInstance } from 'fastify';
import { PushSender } from '../../adapters/push-sender/fcm.adapter.js';

export async function testPushRoute(app: FastifyInstance) {
  app.post('/test/push', {
    schema: {
      body: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const {
      token,
      title = 'Vifosa Test 🔔',
      body = 'Firebase Admin SDK hoạt động!',
    } = request.body as any;

    const result = await PushSender.send([token], { title, body });
    return reply.send({ ok: true, result });
  });
}