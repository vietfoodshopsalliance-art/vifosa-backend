import mongoose from 'mongoose';
import { MenuItem } from '../modules/db/menu.model.js';
import { Order } from '../modules/db/orders.model.js';

export async function runUpdateSoldCount() {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const threeSixtyFiveDaysAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);

  const [allTime, last365d, last30d, last7d] = await Promise.all([
    Order.aggregate([
      { $match: { mainStatus: 'completed' } },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemId', count: { $sum: '$items.qty' } } },
    ]),
    Order.aggregate([
      { $match: { mainStatus: 'completed', createdAt: { $gte: threeSixtyFiveDaysAgo } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemId', count: { $sum: '$items.qty' } } },
    ]),
    Order.aggregate([
      { $match: { mainStatus: 'completed', createdAt: { $gte: thirtyDaysAgo } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemId', count: { $sum: '$items.qty' } } },
    ]),
    Order.aggregate([
      { $match: { mainStatus: 'completed', createdAt: { $gte: sevenDaysAgo } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemId', count: { $sum: '$items.qty' } } },
    ]),
  ]);

  const allTimeMap = new Map(allTime.map((x: any) => [String(x._id), x.count]));
  const last365dMap = new Map(last365d.map((x: any) => [String(x._id), x.count]));
  const last30dMap = new Map(last30d.map((x: any) => [String(x._id), x.count]));
  const last7dMap = new Map(last7d.map((x: any) => [String(x._id), x.count]));

  // Reset rolling windows về 0, rồi bulk-update
  await MenuItem.updateMany({}, {
    $set: {
      'soldCount.last7d': 0,
      'soldCount.last30d': 0,
      'soldCount.last365d': 0,
    },
  });

  const allIds = new Set([...allTimeMap.keys(), ...last365dMap.keys(), ...last30dMap.keys(), ...last7dMap.keys()]);
  const ops = Array.from(allIds).map((id) => ({
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(id) },
      update: {
        $set: {
          'soldCount.allTime': allTimeMap.get(id) ?? 0,
          'soldCount.last365d': last365dMap.get(id) ?? 0,
          'soldCount.last30d': last30dMap.get(id) ?? 0,
          'soldCount.last7d': last7dMap.get(id) ?? 0,
        },
      },
    },
  }));

  if (ops.length > 0) await MenuItem.bulkWrite(ops);
}
