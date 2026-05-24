// backend/src/modules/home/home.controller.ts

import type { FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { Store, Order, Like } from '../db/index.js';
import { verifyAccessToken } from '../../utils/jwt.js';

const N = 2; // stores per group (admin configurable later via Setting)
const PAGE_SIZE = 20;
const MAX_RADIUS_KM = 25;
const DEFAULT_RADIUS_KM = 5;
const EARTH_RADIUS_KM = 6371;

const SELECT_FIELDS = 'name description avatarImage coverImage address isOpen emergencyClosed stats vipTier';

function toStoreCard(store: any, distanceMeters?: number) {
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
    vipTier: store.vipTier ?? 'none',
  };
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
  // cursor = skip offset for group 6 load-more
  const cursor = q.cursor != null ? Number(q.cursor) : null;
  const userId = extractUserId(req);

  const hasGeo = lat != null && lng != null && !isNaN(lat) && !isNaN(lng);
  const baseFilter = { isSuspended: false, isDeleted: { $ne: true } };

  // ── Load-more: only return next page of group 6 ────────────────────────────
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
    return reply.send({
      nearbyStores: page.map(s => toStoreCard(s, (s as any).distanceMeters)),
      nextCursor: hasMore ? cursor + PAGE_SIZE : null,
      hasMore,
    });
  }

  // ── Full initial load ───────────────────────────────────────────────────────
  // $geoWithin allows custom sort (unlike $near which forces distance sort)
  const geoWithin = hasGeo
    ? { 'address.location': { $geoWithin: { $centerSphere: [[lng!, lat!], radiusKm / EARTH_RADIUS_KM] } } }
    : {};

  const excludeIds = new Set<string>();
  const toOIds = (ids: Set<string>) => [...ids].map(id => new mongoose.Types.ObjectId(id));

  // ── Group 1: n newest ≤30 days, within radius ───────────────────────────────
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

  // ── Group 3: n best-selling 30 days, within radius ──────────────────────────
  const trendingStores = await Store.find({
    ...baseFilter,
    ...geoWithin,
    _id: { $nin: toOIds(excludeIds) },
  })
    .sort({ 'stats.completedOrdersThisMonth': -1 })
    .limit(N)
    .select(SELECT_FIELDS)
    .lean();
  trendingStores.forEach(s => excludeIds.add(String(s._id)));

  // ── Group 4: recently purchased (no radius) ──────────────────────────────────
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

  // ── Group 5: favorites (no radius) ──────────────────────────────────────────
  let favorites: any[] = [];
  if (userId) {
    const liked = await Like.find({ userId, targetType: 'store' })
      .sort({ createdAt: -1 })
      .limit(20)
      .select('targetId')
      .lean();

    // Không lọc excludeIds: "Yêu thích" là section cá nhân hoá,
    // luôn hiện đúng top-N quán user đã like dù có trùng section khác.
    const favIds = liked
      .map((l: any) => l.targetId)
      .slice(0, N);

    if (favIds.length > 0) {
      favorites = await Store.find({ ...baseFilter, _id: { $in: favIds } })
        .select(SELECT_FIELDS)
        .lean();
    }
    favorites.forEach(s => excludeIds.add(String(s._id)));
  }

  // ── Group 6: remaining nearby, sorted by distance ───────────────────────────
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

  return reply.send({
    newStores:       newStores.map(s => toStoreCard(s)),
    trendingStores:  trendingStores.map(s => toStoreCard(s)),
    recentPurchases: recentPurchases.map(s => toStoreCard(s)),
    favorites:       favorites.map(s => toStoreCard(s)),
    nearbyStores:    nearbyPage.map(s => toStoreCard(s, (s as any).distanceMeters)),
    nextCursor:      hasMore ? PAGE_SIZE : null,
    hasMore,
  });
}
