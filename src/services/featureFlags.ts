import { Router, Request, Response } from 'express';
import { getAllFlags } from '../services/featureFlags';
import { logger } from '../config/logger';
import { getRequestId } from '../lib/requestContext';

export const featureFlagsRouter = Router();

/**
 * GET /feature-flags
 * Public endpoint returning active feature flag values for the calling user/client.
 */
featureFlagsRouter.get('/', (req: Request, res: Response) => {
  const reqId = getRequestId() || (req.headers['x-correlation-id'] as string) || crypto.randomUUID();

  logger.info({ reqId, path: req.originalUrl }, 'Fetching public feature flags');

  try {
    const flags = getAllFlags();

    // Transform array into key-value map format for client consumption
    const flagMap = flags.reduce((acc, flag) => {
      acc[flag.id] = {
        enabled: flag.enabled,
        variant: flag.variant ?? null,
      };
      return acc;
    }, {} as Record<string, { enabled: boolean; variant: string | null }>);

    res.setHeader('x-correlation-id', reqId);
    return res.status(200).json({
      success: true,
      data: flagMap,
      correlationId: reqId,
    });
  } catch (error) {
    logger.error({ err: error, reqId }, 'Failed to fetch public feature flags');

    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while retrieving feature flags',
      },
      correlationId: reqId,
    });
  }
});
