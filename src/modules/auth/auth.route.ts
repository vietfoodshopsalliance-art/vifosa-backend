// backend/src/modules/auth/auth.routes.ts
import type { FastifyInstance } from 'fastify';
import * as Controller from './auth.controller.js';
import { requireAuth, requireRole } from '../../middleware/auth.middleware.js';

export async function authRoutes(fastify: FastifyInstance) {
  // Public routes
  fastify.post('/auth/register', Controller.register);
  fastify.post('/auth/login', Controller.login);
  fastify.post('/auth/refresh', Controller.refresh);
  fastify.post('/auth/logout', Controller.logout);

  // Protected routes (cần JWT)
  fastify.get('/me', { preHandler: requireAuth }, Controller.getMe);
  fastify.post('/me/fcm-token', { preHandler: requireAuth }, Controller.addFcmToken);
  fastify.delete('/me/fcm-token', { preHandler: requireAuth }, Controller.removeFcmToken);
  fastify.post('/tos/accept', { preHandler: requireAuth }, Controller.acceptTos);
}