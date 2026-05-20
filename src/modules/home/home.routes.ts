import type { FastifyInstance } from 'fastify';
import { homeFeedHandler } from './home.controller.js';

export async function homeRoutes(app: FastifyInstance) {
  app.get('/home-feed', homeFeedHandler);
}
