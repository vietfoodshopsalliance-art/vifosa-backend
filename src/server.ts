// backend/src/server.ts

import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import mongoose from 'mongoose';
import './modules/db/index.js';
import { Server as SocketIOServer } from 'socket.io';

import { healthRoutes } from './modules/health/health.routes.js';
import authRoutes from './modules/auth/auth.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { storesRoutes } from './modules/stores/stores.routes.js';
import menuRoutes from './modules/menu/menu.routes.js';
import './modules/db/orders.model.js';
import { requireAuth } from './middleware/auth.middleware.js';
import { homeRoutes } from './modules/home/home.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';
import { cartRoutes } from './modules/orders/cart.routes.js';
import { orderRoutes } from './modules/orders/order.routes.js';
import { setSocketIO } from './socket/orderEvents.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { notificationPrefsRoutes } from './modules/notifications/notificationPrefs.routes.js';
import { socialRoutes } from './modules/social/social.routes.js';
import './modules/db/social.model.js';
import { reviewRoutes } from './modules/reviews/index.js';
import { adminRoutes } from './modules/admin/admin.routes.js'
import { getPublicSetting } from './modules/admin/controllers/settings.controller.js';
import { trackingRoutes } from './modules/orders/tracking.routes.js';
import { guestOrderRoutes } from './modules/orders/guest-order.routes.js';
import { publicTrackRoutes } from './modules/orders/public-track.routes.js';
import { supportRoutes } from './modules/support/support.routes.js'
import { storeMembershipRoutes } from './modules/stores/store-membership.routes.js';
import { vipRoutes } from './modules/vip/vip.routes.js';
import { initCronJobs } from './jobs/index.js';
import { seedIndexes } from './utils/seedIndexes.js';

const app = Fastify({ logger: true });

await app.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: '1 minute',
});

await app.register(cors, {
  origin: (process.env.ALLOWED_ORIGINS ?? '').split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

await app.register(cookie);

await mongoose.connect(process.env.MONGO_URI!);
app.log.info('MongoDB connected');

// Health check — NO /api prefix (spec 01-setup-auth) bỏ /api
app.register(healthRoutes);

app.register(authRoutes,              { prefix: '/auth' });
app.register(usersRoutes,             { prefix: '' });
app.register(storesRoutes,            { prefix: '' });
app.register(menuRoutes,              { prefix: '/stores' });
app.register(homeRoutes,              { prefix: '' });
app.register(searchRoutes,            { prefix: '' });
app.register(cartRoutes,              { prefix: '' });
app.register(orderRoutes,             { prefix: '' });
app.register(notificationsRoutes,     { prefix: '' });
app.register(notificationPrefsRoutes, { prefix: '' });
app.register(socialRoutes,            { prefix: '' });
app.register(reviewRoutes,            { prefix: '' });
app.register(adminRoutes,             { prefix: '' });
app.get('/settings/:key', getPublicSetting);
app.register(trackingRoutes,          { prefix: '' });
app.register(guestOrderRoutes,        { prefix: '' });
app.register(publicTrackRoutes,       { prefix: '' });
app.register(supportRoutes,            { prefix: '' })
app.register(storeMembershipRoutes,   { prefix: '' })
app.register(vipRoutes,               { prefix: '' })

const PORT = Number(process.env.PORT ?? 8080);

// Cron trigger — luôn register (cần cho production Render cron job)
const { cronTriggerRoute } = await import('./modules/admin/cronTriggerRoute.js');
app.register(cronTriggerRoute, { prefix: '/admin/cron' });

// Dev-only routes cho smoke test
if (process.env.NODE_ENV !== 'production') {
  const { testSeedRoute } = await import('./modules/admin/testSeedRoute.js');
  app.register(testSeedRoute, { prefix: '/admin/test' });
}

await app.listen({ port: PORT, host: '0.0.0.0' });

// Socket.IO phải init SAU app.listen() — lúc đó app.server mới tồn tại
const io = new SocketIOServer(app.server, {
  cors: {
    origin: (process.env.ALLOWED_ORIGINS ?? '').split(','),
    credentials: true,
  },
});

setSocketIO(io);
await initCronJobs();

io.on('connection', (socket) => {
  socket.on('join:order',  (orderId: string) => socket.join(`order:${orderId}`));
  socket.on('join:store',  (storeId: string) => socket.join(`store:${storeId}`));
  socket.on('leave:order', (orderId: string) => socket.leave(`order:${orderId}`));
  socket.on('leave:store', (storeId: string) => socket.leave(`store:${storeId}`));
  socket.on('join:user',   (userId: string)  => socket.join(`user:${userId}`));
  socket.on('join:admin-notifications', () => socket.join('admin:notifications'));
});