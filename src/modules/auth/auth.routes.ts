import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../middleware/auth.middleware.js'
import * as Controller from './auth.controller.js'

export default async function authRoutes(fastify: FastifyInstance) {
  // public (rate-limited toàn cục trong server.ts: 100/min)
  fastify.post('/register', Controller.register)
  fastify.post('/login',    Controller.login)
  fastify.post('/refresh',  Controller.refresh)

  // auth required
  fastify.post('/logout',     { preHandler: [requireAuth] }, Controller.logout)
  fastify.post('/logout-all', { preHandler: [requireAuth] }, Controller.logoutAll)
}
