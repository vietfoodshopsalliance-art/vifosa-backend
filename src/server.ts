import dotenv from 'dotenv';
dotenv.config(); // ← Phải là dòng đầu tiên, trước mọi import khác

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './modules/auth/auth.route.js';
import { testPushRoute } from './modules/admin/test-push.route.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
});

fastify.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

fastify.register(authRoutes, { prefix: '/api/v1' });
fastify.register(testPushRoute);

const port = Number(process.env.PORT) || 8080;

try {
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`Server running on port ${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}