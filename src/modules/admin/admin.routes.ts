// backend/src/modules/admin/admin.routes.ts
import { FastifyInstance } from 'fastify'
import { requireAuth, requireRole } from '../../middleware/auth.middleware.js'
import { runUpdateSoldCount } from '../../jobs/update-sold-count.job.js'
import * as userCtrl from './controllers/users.controller.js'
import * as storeCtrl from './controllers/stores.controller.js'
import * as settingsCtrl from './controllers/settings.controller.js'
import * as reportsCtrl from './controllers/reports.controller.js'
import * as analyticsCtrl from './controllers/analytics.controller.js'
import * as auditCtrl from './controllers/auditLog.controller.js'
import * as productsCtrl from './controllers/products.controller.js'

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // ─── Users (spec §8.4) ────────────────────────────────────────────────────
  app.get('/admin/users',                         { preHandler: requireRole(['admin']) }, userCtrl.listUsers)
  app.get('/admin/users/:userId',                 { preHandler: requireRole(['admin']) }, userCtrl.getUser)
  app.put('/admin/users/:userId/status',          { preHandler: requireRole(['admin']) }, userCtrl.updateStatus)
  app.post('/admin/users/:userId/roles',          { preHandler: requireRole(['admin']) }, userCtrl.addRole)
  app.delete('/admin/users/:userId/roles/:role',  { preHandler: requireRole(['admin']) }, userCtrl.removeRole)
  app.post('/admin/users/:userId/reset-password', { preHandler: requireRole(['admin']) }, userCtrl.resetPassword)
  app.post('/admin/users/:userId/logout-all',     { preHandler: requireRole(['admin']) }, userCtrl.adminLogoutAll)
  app.delete('/admin/users/:userId',              { preHandler: requireRole(['admin']) }, userCtrl.deleteUser)
  app.get('/admin/users/:userId/audit-log',       { preHandler: requireRole(['admin', 'mod']) }, userCtrl.getUserAuditLog)

  // ─── Stores ───────────────────────────────────────────────────────────────
  app.get('/admin/stores',           { preHandler: requireRole(['admin', 'mod']) }, storeCtrl.listStores)
  app.get('/admin/stores/:id',       { preHandler: requireRole(['admin', 'mod']) }, storeCtrl.getStore)
  app.patch('/admin/stores/:id',     { preHandler: requireRole(['admin']) }, storeCtrl.updateStore)
  app.post('/admin/stores/:id/transfer', { preHandler: requireRole(['admin', 'mod']) }, storeCtrl.transferStore)
  app.patch('/admin/stores/:id/override', { preHandler: requireRole(['admin']) }, storeCtrl.overrideStore)
  app.delete('/admin/stores/:id',    { preHandler: requireRole(['admin']) }, storeCtrl.deleteStore)
  app.post('/admin/stores/bulk',     { preHandler: requireRole(['admin']) }, storeCtrl.bulkAction)

  // ─── Products ─────────────────────────────────────────────────────────────
  app.get('/admin/products', { preHandler: requireRole(['admin', 'mod']) }, productsCtrl.listProducts)

  // ─── Settings ─────────────────────────────────────────────────────────────
  app.get('/admin/settings',          { preHandler: requireRole(['admin']) }, settingsCtrl.getSettings)
  app.patch('/admin/settings',        { preHandler: requireRole(['admin']) }, settingsCtrl.updateSettings)
  app.get('/admin/settings/:key',     { preHandler: requireRole(['admin']) }, settingsCtrl.getSetting)
  app.put('/admin/settings/:key',     { preHandler: requireRole(['admin']) }, settingsCtrl.upsertSetting)

  // ─── Reports / Moderation ─────────────────────────────────────────────────
  app.get('/admin/reports',                           { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.listReports)
  app.get('/admin/reports/:id',                       { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.getReport)
  app.patch('/admin/reports/:id/status',              { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.updateStatus)
  app.post('/admin/reports/:id/hide-target',          { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.hideTarget)
  app.post('/admin/reports/:id/restore-target',       { preHandler: requireRole(['admin', 'mod']) }, reportsCtrl.restoreTarget)

  // ─── Support Tickets ──────────────────────────────────────────────────────
  app.get('/admin/support/tickets',      { preHandler: requireRole(['admin', 'mod']) }, auditCtrl.listTickets)
  app.get('/admin/support/tickets/:id',  { preHandler: requireRole(['admin', 'mod']) }, auditCtrl.getTicket)
  app.patch('/admin/support/tickets/:id', { preHandler: requireRole(['admin', 'mod']) }, auditCtrl.replyTicket)

  // ─── Audit Log ────────────────────────────────────────────────────────────
  app.get('/admin/audit-log', { preHandler: requireRole(['admin']) }, auditCtrl.listAuditLog)

  // ─── Analytics ────────────────────────────────────────────────────────────
  app.get('/admin/analytics/orders',            { preHandler: requireRole(['admin']) }, analyticsCtrl.ordersAnalytics)
  app.get('/admin/analytics/top-stores',        { preHandler: requireRole(['admin']) }, analyticsCtrl.topStores)
  app.get('/admin/analytics/top-items',         { preHandler: requireRole(['admin']) }, analyticsCtrl.topItems)
  app.get('/admin/analytics/cancellation-rate', { preHandler: requireRole(['admin']) }, analyticsCtrl.cancellationRate)
  app.get('/admin/dashboard-stats',             { preHandler: requireRole(['admin', 'mod']) }, analyticsCtrl.dashboardStats)

  // ─── Jobs ─────────────────────────────────────────────────────────────────
  app.post('/admin/jobs/update-sold-count', { preHandler: requireRole(['admin']) }, async (_req, reply) => {
    await runUpdateSoldCount()
    return reply.send({ ok: true })
  })
}
