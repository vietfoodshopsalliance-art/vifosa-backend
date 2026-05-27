// backend/src/modules/home/home.controller.ts

import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import NodeCache from 'node-cache';
import { Store, Order, Like, MenuItem } from '../db/index.js';
import { verifyAccessToken } from '../../utils/jwt.js';

const N = 2;
const PAGE_SIZE = 20;
const MAX_RADIUS_KM = 25;
const DEFAULT_RADIUS_KM = 5;
const EARTH_RADIUS_KM = 6371;
const REVIEW_RADIUS_KM = 5;

const feedCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

function buildCacheKey(lat: number | null, lng: number | null, radius: number, userId: string | null): string | null {
  if (lat == null || lng == null) return null;
  const lat2 = (Math.round(lat * 100) / 100).toFixed(2);
  const lng2 = (Math.round(lng * 100) / 100).toFixed(2);
  return userId
    ? `home:${userId}:${lat2}:${lng2}:${radius}`
    : `home:${lat2}:${lng2}:${radius}`;
}

const SELECT_FIELDS = 'name description avatarImage coverImage address isOpen emergencyClosed stats vipTier';

function haversineMeters(userLat: number, userLng: number, storeLat: number, storeLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(storeLat - userLat);
  const dLng = toRad(storeLng - userLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(userLat)) * Math.cos(toRad(storeLat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toStoreCard(store: any, distanceMeters?: number, totalSold = 0) {
  return {
    id: String(store._id),
    name: store.name,
    description: store.description ?? null,
    avatarImage: store.avatarImage ?? null,
    coverImage: store.coverImage ?? null,
    addressText: store.address?.text ?? '',
    distanceKm: distanceMeters != null ? Math.round((distanceMeters / 1000) * 10) / 10 : null,
    isOpen: !!store.isOpen,
    emergencyClosed: !!store.emergencyClosed,
    avgRating: store.stats?.avgRating ?? 0,
    totalReviews: store.stats?.totalReviews ?? 0,
    totalSold,
    vipTier: store.vipTier ?? 'none',
  };
}

async function buildStoreTotalSoldMap(storeIds: mongoose.Types.ObjectId[]): Promise<Map<string, number>> {
  if (storeIds.length === 0) return new Map();
  const rows = await MenuItem.aggregate([
    { $match: { storeId: { $in: storeIds }, isDeleted: false } },
    { $group: { _id: '$storeId', total: { $sum: '$soldCount.allTime' } } },
  ]);
  return new Map(rows.map((r: any) => [String(r._id), r.total as number]));
}

function toItemCard(item: any, storeDoc: any, userLat?: number, userLng?: number): any {
  let dm = storeDoc?.distanceMeters as number | undefined;
  if (dm == null && userLat != null && userLng != null) {
    const coords = storeDoc?.address?.location?.coordinates;
    if (Array.isArray(coords) && coords.length === 2) {
      dm = haversineMeters(userLat, userLng, coords[1] as number, coords[0] as number);
    }
  }
  return {
    id: String(item._id),
    name: item.name as string,
    description: (item.description as string | null) ?? null,
    price: item.price as number,
    image: ((item.images as string[])[0]) ?? null,
    soldCount: (item.soldCount as any)?.allTime ?? 0,
    distanceKm: dm != null ? Math.round((dm / 1000) * 10) / 10 : null,
    storeId: String(item.storeId),
    avgRating: storeDoc?.stats?.avgRating ?? 0,
    totalReviews: storeDoc?.stats?.totalReviews ?? 0,
  };
}

// Lấy nearbyItems từ các store docs (đã có distanceMeters nếu geo)
async function buildNearbyItems(rawStoreDocs: any[], userLat?: number, userLng?: number): Promise<any[]> {
  if (rawStoreDocs.length === 0) return [];

  const storeIds = rawStoreDocs.map((s: any) => s._id);

  const itemDocs = await MenuItem.find({
    storeId: { $in: storeIds },
    status: 'active',
    isDeleted: false,
  })
    .select('storeId name description price images soldCount')
    .lean();

  const storeInfoMap = new Map<string, { distanceMeters?: number; stats?: any; address?: any }>(
    rawStoreDocs.map((s: any) => [
      String(s._id),
      { distanceMeters: s.distanceMeters as number | undefined, stats: s.stats, address: s.address },
    ])
  );

  return itemDocs
    .map((item: any) => {
      const info = storeInfoMap.get(String(item.storeId));
      let dm = info?.distanceMeters;
      if (dm == null && userLat != null && userLng != null) {
        const coords = info?.address?.location?.coordinates;
        if (Array.isArray(coords) && coords.length === 2) {
          dm = haversineMeters(userLat, userLng, coords[1] as number, coords[0] as number);
        }
      }
      return {
        id: String(item._id),
        name: item.name as string,
        description: (item.description as string | null) ?? null,
        price: item.price as number,
        image: ((item.images as string[])[0]) ?? null,
        soldCount: (item.soldCount as any)?.allTime ?? 0,
        distanceKm: dm != null ? Math.round((dm / 1000) * 10) / 10 : null,
        storeId: String(item.storeId),
        avgRating: (info?.stats as any)?.avgRating ?? 0,
        totalReviews: (info?.stats as any)?.totalReviews ?? 0,
      };
    })
    .sort((a: any, b: any) => (a.distanceKm ?? 999) - (b.distanceKm ?? 999));
}

// Lấy món bán chạy nhất cho mỗi store trong danh sách (1 query thay vì N queries)
async function buildTopItemsForStores(storeDocs: any[], userLat?: number, userLng?: number): Promise<any[]> {
  if (storeDocs.length === 0) return [];
  const storeIds = storeDocs.map((s: any) => s._id);

  const allItems = await MenuItem.find({
    storeId: { $in: storeIds },
    status: 'active',
    isDeleted: false,
  })
    .sort({ 'soldCount.allTime': -1 })
    .select('storeId name description price images soldCount')
    .lean();

  const storeInfoMap = new Map(storeDocs.map((s: any) => [String(s._id), s]));
  const seen = new Set<string>();
  const resultMap = new Map<string, any>();

  for (const item of allItems) {
    const sid = String(item.storeId);
    if (seen.has(sid)) continue;
    seen.add(sid);
    const storeDoc = storeInfoMap.get(sid);
    resultMap.set(sid, toItemCard(item, storeDoc, userLat, userLng));
    if (resultMap.size >= storeDocs.length) break;
  }

  // Maintain order of storeDocs
  return storeDocs
    .map(s => resultMap.get(String(s._id)))
    .filter((r): r is any => r != null);
}

// Top 10 món bán chạy nhất all-time, toàn quốc
async function buildTopSellingItemsGlobal(userLat?: number, userLng?: number): Promise<any[]> {
  const itemDocs = await MenuItem.find({ status: 'active', isDeleted: false })
    .sort({ 'soldCount.allTime': -1 })
    .limit(10)
    .select('storeId name description price images soldCount')
    .lean();

  if (itemDocs.length === 0) return [];

  const storeIds = [...new Set(itemDocs.map((i: any) => String(i.storeId)))];
  const storeDocs = await Store.find({ _id: { $in: storeIds } })
    .select('stats address')
    .lean();
  const storeMap = new Map(storeDocs.map((s: any) => [String(s._id), s]));

  return itemDocs.map((item: any) => toItemCard(item, storeMap.get(String(item.storeId)), userLat, userLng));
}

// Món bán chạy nhất của top 5 quán có nhiều đánh giá nhất trong 5km cố định
async function buildTopReviewedStoreItems(lat: number, lng: number, baseFilter: any): Promise<any[]> {
  const topReviewedStores = await Store.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceMeters',
        maxDistance: REVIEW_RADIUS_KM * 1000,
        spherical: true,
        query: baseFilter,
      },
    },
    { $sort: { 'stats.totalReviews': -1 } },
    { $limit: 5 },
    { $project: { stats: 1, distanceMeters: 1 } },
  ]);
  return buildTopItemsForStores(topReviewedStores, lat, lng);
}

// Items cá nhân: 5 món đã like + 5 món đã mua gần đây + top item của 5 quán yêu thích
async function buildPersonalItems(userId: string, userLat?: number, userLng?: number): Promise<any[]> {
  const allItems: any[] = [];
  const seenItemIds = new Set<string>();

  // 5 món đã like (targetType: 'item')
  const likedItemLikes = await Like.find({ userId, targetType: 'item' })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('targetId')
    .lean();

  if (likedItemLikes.length > 0) {
    const likedIds = likedItemLikes.map((l: any) => l.targetId);
    const likedDocs = await MenuItem.find({
      _id: { $in: likedIds },
      status: 'active',
      isDeleted: false,
    }).select('storeId name description price images soldCount').lean();

    const sids = [...new Set(likedDocs.map((i: any) => String(i.storeId)))];
    const storeDocs = await Store.find({ _id: { $in: sids } }).select('stats address').lean();
    const storeMap = new Map(storeDocs.map((s: any) => [String(s._id), s]));

    for (const item of likedDocs) {
      const id = String(item._id);
      if (seenItemIds.has(id)) continue;
      seenItemIds.add(id);
      allItems.push(toItemCard(item, storeMap.get(String(item.storeId)), userLat, userLng));
    }
  }

  // 5 món đã mua gần đây
  const recentOrders = await Order.find({ customerId: userId, mainStatus: 'completed' })
    .sort({ createdAt: -1 })
    .limit(20)
    .select('items')
    .lean();

  const recentItemIds: mongoose.Types.ObjectId[] = [];
  const seenOrderItemIds = new Set<string>();
  outer:
  for (const order of recentOrders) {
    for (const oi of (order.items || [])) {
      const iid = String(oi.itemId);
      if (!seenOrderItemIds.has(iid) && !seenItemIds.has(iid)) {
        seenOrderItemIds.add(iid);
        recentItemIds.push(oi.itemId as mongoose.Types.ObjectId);
        if (recentItemIds.length >= 5) break outer;
      }
    }
  }

  if (recentItemIds.length > 0) {
    const purchasedDocs = await MenuItem.find({
      _id: { $in: recentItemIds },
      status: 'active',
      isDeleted: false,
    }).select('storeId name description price images soldCount').lean();

    const sids = [...new Set(purchasedDocs.map((i: any) => String(i.storeId)))];
    const storeDocs = await Store.find({ _id: { $in: sids } }).select('stats address').lean();
    const storeMap = new Map(storeDocs.map((s: any) => [String(s._id), s]));

    for (const item of purchasedDocs) {
      const id = String(item._id);
      if (seenItemIds.has(id)) continue;
      seenItemIds.add(id);
      allItems.push(toItemCard(item, storeMap.get(String(item.storeId)), userLat, userLng));
    }
  }

  // Món bán chạy nhất của 5 quán yêu thích
  const favStoreLikes = await Like.find({ userId, targetType: 'store' })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('targetId')
    .lean();

  if (favStoreLikes.length > 0) {
    const favStoreIds = favStoreLikes.map((l: any) => l.targetId);
    const favStoreDocs = await Store.find({ _id: { $in: favStoreIds } })
      .select('stats address')
      .lean();
    const favItems = await buildTopItemsForStores(favStoreDocs, userLat, userLng);
    for (const item of favItems) {
      if (!seenItemIds.has(item.id)) {
        seenItemIds.add(item.id);
        allItems.push(item);
      }
    }
  }

  return allItems;
}

function extractUserId(req: FastifyRequest): string | null {
  try {
    let token: string | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7);
    if (!token) token = (req as any).cookies?.accessToken;
    if (!token) return null;
    const payload = verifyAccessToken(token);
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

export async function homeFeedHandler(req: FastifyRequest, reply: FastifyReply) {
  const q = req.query as Record<string, string>;

  const lat = q.lat != null ? Number(q.lat) : null;
  const lng = q.lng != null ? Number(q.lng) : null;
  const radiusKm = Math.min(Math.max(Number(q.radius ?? DEFAULT_RADIUS_KM), 1), MAX_RADIUS_KM);
  const cursor = q.cursor != null ? Number(q.cursor) : null;
  const userId = extractUserId(req);

  const hasGeo = lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
  const baseFilter = { isSuspended: false, isDeleted: { $ne: true } };

  // ── Load-more: trả nearbyStores + nearbyItems trang tiếp theo ─────────────
  if (cursor !== null) {
    const nearbyStores = hasGeo
      ? await Store.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [lng!, lat!] },
              distanceField: 'distanceMeters',
              maxDistance: radiusKm * 1000,
              spherical: true,
              query: baseFilter,
            },
          },
          { $skip: cursor },
          { $limit: PAGE_SIZE + 1 },
          { $project: { name:1, description:1, avatarImage:1, coverImage:1, address:1, isOpen:1, emergencyClosed:1, stats:1, vipTier:1, distanceMeters:1 } },
        ])
      : await Store.find(baseFilter)
          .select(SELECT_FIELDS)
          .sort({ 'stats.completedOrdersThisMonth': -1, _id: -1 })
          .skip(cursor)
          .limit(PAGE_SIZE + 1)
          .lean();

    const hasMore = nearbyStores.length > PAGE_SIZE;
    const page = nearbyStores.slice(0, PAGE_SIZE);
    const [nearbyItems, soldMap] = await Promise.all([
      buildNearbyItems(page, hasGeo ? lat! : undefined, hasGeo ? lng! : undefined),
      buildStoreTotalSoldMap(page.map((s: any) => s._id)),
    ]);

    return reply.send({
      nearbyStores: page.map((s: any) => toStoreCard(s, (s as any).distanceMeters, soldMap.get(String(s._id)) ?? 0)),
      nearbyItems,
      nextCursor: hasMore ? cursor + PAGE_SIZE : null,
      hasMore,
    });
  }

  // ── Cache check ──────────────────────────────────────────────────────────
  const cKey = buildCacheKey(lat, lng, radiusKm, userId);
  if (cKey) {
    const hit = feedCache.get(cKey);
    if (hit) return reply.send(hit);
  }

  // ── Full initial load ─────────────────────────────────────────────────────
  const geoWithin = hasGeo
    ? { 'address.location': { $geoWithin: { $centerSphere: [[lng!, lat!], radiusKm / EARTH_RADIUS_KM] } } }
    : {};

  const excludeIds = new Set<string>();
  const toOIds = (ids: Set<string>) => [...ids].map(id => new mongoose.Types.ObjectId(id));

  // Group 1: Quán mới ≤30 ngày
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const newStores = await Store.find({
    ...baseFilter,
    ...geoWithin,
    createdAt: { $gte: thirtyDaysAgo },
  })
    .sort({ createdAt: -1 })
    .limit(N)
    .select(SELECT_FIELDS)
    .lean();
  newStores.forEach(s => excludeIds.add(String(s._id)));

  // Group 3: Bán chạy (trending stores - vẫn giữ cho nearbyItems)
  const orderRank = await Order.aggregate([
    { $match: { mainStatus: 'completed', createdAt: { $gte: thirtyDaysAgo } } },
    { $group: { _id: '$storeId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: N * 6 },
  ]);
  let trendingStores: any[] = [];
  if (orderRank.length > 0) {
    const rankedIds = orderRank.map(r => r._id);
    const docs = await Store.find({
      ...baseFilter,
      ...geoWithin,
      _id: { $in: rankedIds, $nin: toOIds(excludeIds) },
    }).select(SELECT_FIELDS).lean();
    const countMap = new Map(orderRank.map(r => [r._id.toString(), r.count as number]));
    trendingStores = docs
      .sort((a, b) => (countMap.get(b._id.toString()) ?? 0) - (countMap.get(a._id.toString()) ?? 0))
      .slice(0, N);
  }
  if (trendingStores.length < N) {
    const fallbackExclude = new Set([...excludeIds, ...trendingStores.map(s => String(s._id))]);
    const fallback = await Store.find({
      ...baseFilter,
      ...geoWithin,
      _id: { $nin: toOIds(fallbackExclude) },
    }).limit(N - trendingStores.length).select(SELECT_FIELDS).lean();
    trendingStores.push(...fallback);
  }
  trendingStores.forEach(s => excludeIds.add(String(s._id)));

  // Group 4: Đã mua gần đây
  let recentPurchases: any[] = [];
  if (userId) {
    const recentOrders = await Order.find({ customerId: userId, mainStatus: 'completed' })
      .sort({ createdAt: -1 })
      .limit(30)
      .select('storeId')
      .lean();

    const seen = new Set<string>();
    const recentStoreIds: mongoose.Types.ObjectId[] = [];
    for (const o of recentOrders) {
      const sid = String(o.storeId);
      if (!seen.has(sid) && !excludeIds.has(sid)) {
        seen.add(sid);
        recentStoreIds.push(o.storeId as mongoose.Types.ObjectId);
        if (recentStoreIds.length >= N) break;
      }
    }
    if (recentStoreIds.length > 0) {
      recentPurchases = await Store.find({ ...baseFilter, _id: { $in: recentStoreIds } })
        .select(SELECT_FIELDS)
        .lean();
    }
    recentPurchases.forEach(s => excludeIds.add(String(s._id)));
  }

  // Group 5: Yêu thích
  let favorites: any[] = [];
  if (userId) {
    const liked = await Like.find({ userId, targetType: 'store' })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('targetId')
      .lean();

    const favIds = liked.map((l: any) => l.targetId).slice(0, N);
    if (favIds.length > 0) {
      favorites = await Store.find({ ...baseFilter, _id: { $in: favIds } })
        .select(SELECT_FIELDS)
        .lean();
    }
    favorites.forEach(s => excludeIds.add(String(s._id)));
  }

  // Group 6: Quán gần bạn (sorted by distance)
  const nearbyQuery = { ...baseFilter, _id: { $nin: toOIds(excludeIds) } };
  let nearbyStores: any[];
  if (hasGeo) {
    nearbyStores = await Store.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng!, lat!] },
          distanceField: 'distanceMeters',
          maxDistance: radiusKm * 1000,
          spherical: true,
          query: nearbyQuery,
        },
      },
      { $limit: PAGE_SIZE + 1 },
      { $project: { name:1, description:1, avatarImage:1, coverImage:1, address:1, isOpen:1, emergencyClosed:1, stats:1, vipTier:1, distanceMeters:1 } },
    ]);
  } else {
    nearbyStores = await Store.find(nearbyQuery)
      .select(SELECT_FIELDS)
      .sort({ 'stats.completedOrdersThisMonth': -1, _id: -1 })
      .limit(PAGE_SIZE + 1)
      .lean();
  }

  const hasMore = nearbyStores.length > PAGE_SIZE;
  const nearbyPage = nearbyStores.slice(0, PAGE_SIZE);

  // Gộp tất cả store group để build nearbyItems — tránh bỏ sót quán mới/trending
  const seenIds = new Set<string>();
  const allStoreDocs = [
    ...newStores, ...trendingStores, ...recentPurchases, ...favorites, ...nearbyPage,
  ].filter((s) => {
    const sid = String(s._id);
    if (seenIds.has(sid)) return false;
    seenIds.add(sid);
    return true;
  });
  const userLat = hasGeo ? lat! : undefined;
  const userLng = hasGeo ? lng! : undefined;

  // ── Priority sections + nearbyItems + totalSold map (tất cả song song) ──────
  const allStoreIds = allStoreDocs.map((s: any) => s._id);

  const [nearbyItems, newStoreItems, topSellingItems, topReviewedStoreItems, personalItems, soldMap] = await Promise.all([
    buildNearbyItems(allStoreDocs, userLat, userLng),
    buildTopItemsForStores(newStores, userLat, userLng),
    buildTopSellingItemsGlobal(userLat, userLng),
    hasGeo ? buildTopReviewedStoreItems(lat!, lng!, baseFilter) : Promise.resolve([]),
    userId ? buildPersonalItems(userId, userLat, userLng) : Promise.resolve([]),
    buildStoreTotalSoldMap(allStoreIds),
  ]);

  const ts = (s: any) => soldMap.get(String(s._id)) ?? 0;

  const payload = {
    newStoreItems,
    topSellingItems,
    topReviewedStoreItems,
    personalItems,
    newStores:       newStores.map(s => toStoreCard(s, undefined, ts(s))),
    trendingStores:  trendingStores.map(s => toStoreCard(s, undefined, ts(s))),
    recentPurchases: recentPurchases.map(s => toStoreCard(s, undefined, ts(s))),
    favorites:       favorites.map(s => toStoreCard(s, undefined, ts(s))),
    nearbyStores:    nearbyPage.map(s => toStoreCard(s, (s as any).distanceMeters, ts(s))),
    nearbyItems,
    nextCursor:      hasMore ? PAGE_SIZE : null,
    hasMore,
  };
  if (cKey) feedCache.set(cKey, payload);
  return reply.send(payload);
}
