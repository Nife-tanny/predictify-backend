import { z } from 'zod';

export const featureFlagsQuerySchema = z.object({
  environment: z.enum(['development', 'testnet', 'mainnet']).optional(),
  clientVersion: z.string().optional(),
});

export type FeatureFlagsQuery = z.infer<typeof featureFlagsQuerySchema>;
