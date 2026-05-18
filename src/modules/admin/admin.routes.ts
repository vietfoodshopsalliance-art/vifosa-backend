// backend/src/modules/admin/admin.routes.ts
import { FastifyInstance } from 'fastify';
import { requireAuth, requireRole } from '../../middleware/auth.middleware.js';
import * as userCtrl from './controllers/users.controller.js';
import * as storeCtrl from './controllers/stores.controller.js';
import * as settingsCtrl from './controllers/settings.controller.js';
import * as reportsCtrl from './controllers/reports.controller.js';
import * as analyticsCtrl from './controllers/analytics.controller.js';
import * as auditCtrl from './controllers/auditLog.controller.js';

export async function adminRoutes(app: FastifyInstance) {
  // Tất cả /admin/* đều cần auth + role admin hoặc mod (tuỳ endpoint)
  app.addHook('preHandler', requireAuth);

  // ─── Users ────────────────────────────────────────────────────────────────
  app.get('/admin/users', { preHandler: requireRole(['admin', 'mod']) }, userCtrl.listUsers);
  app.get('/admin/users/:id', { preHandler: requireRole(['admin', 'mod']) }, userCtrl.getUser);
  app.patch('/admin/users/:id/suspend', { preHandler: requireRole(['admin']) }, userCtrl.suspendUser);
  app.post('/admin/users/:id/reset-password', { preHandler: requireRole(['admin']) }, userCtrl.resetPassword);
  app.patch('/admin/users/:id/roles', { preHandler: requireRole(['admin']) }, userCtrl.updateRoles);
  app.get('/admin/users/:id/audit-log', { preHandler: requireRole(['admin', 'mod']) }, userCtrl.getUserAuditLog);

  // ─── Stores ───────────────────────────────────────────────────────────────
  app.get('/admin/stores', { preHandler: requireRole(['admin', 'mod']) }, storeCtrl.listStores);
  app.get('/admin/stores/:id', { preHandler: requireRole(['admin', 'mod']) }, storeCtrl.getStore);
  app.patch('/admin/stores/:id', { preHandler: requireRole(['admin']) }, storeCtrl.updateStore);
  app.post('/admin/stores/:id/transfer', { preHandler: requireRole(['admin', 'mod']) }, storeCtrl.transferStore);
  app.patch('/admin/stores/:id/override', { preHandler: requireRole(['admin']) }, storeCtrl.overrideStore);
  app.delete('/admin/stores/:id', { preHandler: requireRole(['admin']) }, storeCtrl.deleteStore);
  app.post('/admin/stores/bulk', { preHandler: requireRole(['admin']) }, storeCtrl.bulkAction);

  // ─── Settings ─────────────────────────────────────────────────────────────
  app.get('/admin/settings', { preHandler: requireRole(['admin']) }, settingsCtrl.getSettings);
  app.patch('/admin/settings', { preHandler: requireRole(['admin']) }, settingsCtrl.updateSettings);

  // ─── Reports / Moderation ─────────────────────────────────────────────────
  app.get('/admin/reports', { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.listReports);
  app.get('/admin/reports/:id', { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.getReport);
  app.patch('/admin/reports/:id/status', { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.updateStatus);
  app.post('/admin/reports/:id/hide-target', { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.hideTarget);
  app.post('/admin/reports/:id/restore-target', { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.restoreTarget);

  // ─── Support Tickets ──────────────────────────────────────────────────────
  app.get('/admin/support/tickets', { preHandler: requireRole(['admin', 'mod']) }, auditCtrl.listTickets);
  app.get('/admin/support/tickets/:id', { preHandler: requireRole(['admin', 'mod']) }, auditCtrl.getTicket);
  app.patch('/admin/support/tickets/:id', { preHandler: requireRole(['admin', 'mod']) }, auditCtrl.replyTicket);

  // ─── Audit Log ────────────────────────────────────────────────────────────
  app.get('/admin/audit-log', { preHandler: requireRole(['admin']) }, auditCtrl.listAuditLog);

  // ─── Analytics ────────────────────────────────────────────────────────────
  app.get('/admin/analytics/orders', { preHandler: requireRole(['admin']) }, analyticsCtrl.ordersAnalytics);
  app.get('/admin/analytics/top-stores', { preHandler: requireRole(['admin']) }, analyticsCtrl.topStores);
  app.get('/admin/analytics/top-items', { preHandler: requireRole(['admin']) }, analyticsCtrl.topItems);
  app.get('/admin/analytics/cancellation-rate', { preHandler: requireRole(['admin']) }, analyticsCtrl.cancellationRate);
  app.get('/admin/dashboard-stats', { preHandler: requireRole(['admin', 'mod']) }, analyticsCtrl.dashboardStats);
}