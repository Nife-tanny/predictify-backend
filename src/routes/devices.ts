import { Router } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db";
import { refreshTokens } from "../db/schema";
import { requireAuth } from "../middleware/requireAuth";
import { AuthenticatedRequest } from "../middleware/auth";
import { logger } from "../config/logger";

export interface DeviceSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
}

export const devicesRouter = Router();

devicesRouter.use(requireAuth);

devicesRouter.get(
  "/",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.id;

      const rows = await db
        .select({
          familyId: refreshTokens.familyId,
          createdAt: refreshTokens.createdAt,
          expiresAt: refreshTokens.expiresAt,
        })
        .from(refreshTokens)
        .where(
          and(
            eq(refreshTokens.userId, userId),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, new Date()),
          ),
        );

      const byFamily = new Map<string, DeviceSummary>();
      for (const row of rows) {
        const existing = byFamily.get(row.familyId);
        if (!existing || row.createdAt > new Date(existing.createdAt)) {
          byFamily.set(row.familyId, {
            id: row.familyId,
            createdAt: row.createdAt.toISOString(),
            expiresAt: row.expiresAt.toISOString(),
          });
        }
      }

      const devices = Array.from(byFamily.values()).sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      );

      logger.info({ userId, count: devices.length }, "me_devices_listed");

      return res.json({ data: { devices } });
    } catch (err) {
      return next(err);
    }
  },
);
