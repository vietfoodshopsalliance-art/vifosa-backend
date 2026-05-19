// backend/src/modules/admin/controllers/analytics.controller.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { Order } from '../../db/orders.model.js';
import { Store } from '../../db/stores.model.js';
import { SupportTicket } from '../../db/misc.model.js';
import { Report } from '../../db/social.model.js';

function periodToDays(period: string): number {
  const map: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  return map[period] ?? 30;
}

function dateFrom(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// GET /admin/analytics/orders?period=7d|30d|90d
export async function ordersAnalytics(req: FastifyRequest, reply: FastifyReply) {
  const { period = '30d' } = req.query as any;
  const from = dateFrom(periodToDays(period));

  const result = await Order.aggregate([
    { $match: { createdAt: { $gte: from } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$mainStatus', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$mainStatus', 'cancelled'] }, 1, 0] } },
        revenue: { $sum: { $cond: [{ $eq: ['$mainStatus', 'completed'] }, '$totalAmount', 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return reply.send(result);
}

// GET /admin/analytics/top-stores?period=30d&limit=10
export async function topStores(req: FastifyRequest, reply: FastifyReply) {
  const { period = '30d', limit = '10' } = req.query as any;
  const from = dateFrom(periodToDays(period));

  const result = await Order.aggregate([
    { $match: { createdAt: { $gte: from }, mainStatus: 'completed' } },
    { $group: { _id: '$storeId', orderCount: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
    { $sort: { orderCount: -1 } },
    { $limit: parseInt(limit) },
    {
      $lookup: {
        from: 'stores',
        localField: '_id',
        foreignField: '_id',
        as: 'store',
      },
    },
    { $unwind: { path: '$store', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        storeId: '$_id',
        storeName: '$store.name',
        orderCount: 1,
        revenue: 1,
      },
    },
  ]);

  return reply.send(result);
}

// GET /admin/analytics/top-items?period=30d&limit=10
export async function topItems(req: FastifyRequest, reply: FastifyReply) {
  const { period = '30d', limit = '10' } = req.query as any;
  const from = dateFrom(periodToDays(period));

  const result = await Order.aggregate([
    { $match: { createdAt: { $gte: from }, mainStatus: 'completed' } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.menuItemId',
        name: { $first: '$items.name' },
        totalSold: { $sum: '$items.quantity' },
      },
    },
    { $sort: { totalSold: -1 } },
    { $limit: parseInt(limit) },
  ]);

  return reply.send(result);
}

// GET /admin/analytics/cancellation-rate?period=30d
export async function cancellationRate(req: FastifyRequest, reply: FastifyReply) {
  const { period = '30d' } = req.query as any;
  const from = dateFrom(periodToDays(period));

  const [total, cancelled, refunded] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: from }, mainStatus: { $ne: 'cart' } }),
    Order.countDocuments({ createdAt: { $gte: from }, mainStatus: 'cancelled' }),
    Order.countDocuments({ createdAt: { $gte: from }, 'refund.status': 'refunded' }),
  ]);

  return reply.send({
    total,
    cancelled,
    refunded,
    cancellationRate: total ? (cancelled / total) : 0,
    refundRate: total ? (refunded / total) : 0,
  });
}

// GET /admin/dashboard-stats
export async function dashboardStats(_req: FastifyRequest, reply: FastifyReply) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [ordersToday, activeStores, openTickets, openReports] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: today }, mainStatus: { $ne: 'cart' } }),
    Store.countDocuments({ isSuspended: false }),
    SupportTicket.countDocuments({ status: 'open' }),
    Report.countDocuments({ status: 'open' }),
  ]);

  const alerts: { type: string; message: string; href: string }[] = [];
  if (openTickets > 0) {
    alerts.push({ type: 'support', message: `${openTickets} ticket support chưa được trả lời`, href: '/admin/support' });
  }
  if (openReports > 0) {
    alerts.push({ type: 'report', message: `${openReports} báo cáo vi phạm mới`, href: '/admin/reports' });
  }

  return reply.send({ ordersToday, activeStores, openTickets, openReports, alerts });
}