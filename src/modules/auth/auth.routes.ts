import type { FastifyInstance } from 'fastify';
import * as Controller from './auth.controller.js';

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', Controller.register);
  fastify.post('/login',    Controller.login);
  fastify.post('/refresh',  Controller.refresh);
  fastify.post('/logout',   Controller.logout);
}
