import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { refreshTokens } from "../db/schema";
import { requireAuth } from "../middleware/requireAuth";
import { AuthenticatedRequest } from "../middleware/auth";
import { logger } from "../config/logger";
import { RouteErrorFactory } from "../errors";

const paramsSchema = z.object({ id: z.string().uuid({ message: "invalid device id" }) });

export const devicesRevokeRouter = Router({ mergeParams: true });

devicesRevokeRouter.use(requireAuth);

devicesRevokeRouter.post(
  "/",
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) {
        throw RouteErrorFactory.validation(parsed.error.issues[0]?.message ?? "invalid device id");
      }

      const userId = req.user!.id;
      const familyId = parsed.data.id;

      const revoked = await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(refreshTokens.userId, userId),
            eq(refreshTokens.familyId, familyId),
            isNull(refreshTokens.revokedAt),
          ),
        )
        .returning({ id: refreshTokens.id });

      if (revoked.length === 0) {
        logger.info({ userId, familyId }, "me_device_revoke_noop");
        throw RouteErrorFactory.notFound("Device not found");
      }

      logger.info({ userId, familyId, revoked: revoked.length }, "me_device_revoked");
      return res.status(200).json({ data: { id: familyId, revoked: revoked.length } });
    } catch (err) {
      return next(err);
    }
  },
);
