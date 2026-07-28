import { eq } from "drizzle-orm";
import { db } from "../db";
import { predictions, markets } from "../db/schema";
import { getPool } from "../db/client";
import { NotFoundError } from "../errors";

export interface ResolutionStep {
  step: number;
  description: string;
  data: Record<string, unknown>;
  ledger?: number;
  timestamp?: string;
}

export interface PredictionExplanation {
  prediction: {
    id: string;
    marketId: string;
    outcome: string;
    amount: string;
    result: string | null;
    createdAt: string;
  };
  market: {
    id: string;
    question: string;
    winningOutcome: string | null;
    status: string;
    resolutionTime: string;
  };
  resolutionTrail: ResolutionStep[];
  computation: {
    predictedOutcome: string;
    winningOutcome: string | null;
    didWin: boolean;
  };
}

export async function getPredictionExplanation(predictionId: string): Promise<PredictionExplanation> {
  // Fetch prediction
  const [prediction] = await db
    .select()
    .from(predictions)
    .where(eq(predictions.id, predictionId))
    .limit(1);

  if (!prediction) {
    throw new NotFoundError(`Prediction ${predictionId} not found`);
  }

  // Fetch market
  const [market] = await db
    .select()
    .from(markets)
    .where(eq(markets.id, prediction.marketId))
    .limit(1);

  if (!market) {
    throw new NotFoundError(`Market ${prediction.marketId} not found`);
  }

  // Fetch indexer events
  const pool = getPool();
  const eventsResult = await pool.query(
    `SELECT ledger, tx_hash, event_type, payload
     FROM indexer_events 
     WHERE payload::jsonb->>'marketId' = $1 
     ORDER BY ledger ASC`,
    [prediction.marketId],
  );

  const events = eventsResult.rows as Array<{
    ledger: number;
    tx_hash: string;
    event_type: string | null;
    payload: Record<string, unknown> | null;
  }>;

  // Build resolution trail
  const resolutionTrail: ResolutionStep[] = [
    {
      step: 1,
      description: `Prediction placed on market "${market.question}"`,
      data: {
        predictionId,
        outcome: prediction.outcome,
        amount: prediction.amount,
      },
      timestamp: new Date(prediction.createdAt).toISOString(),
    },
  ];

  // Add oracle events
  events.forEach((event, idx) => {
    resolutionTrail.push({
      step: idx + 2,
      description: `Oracle event: ${event.event_type || "contract_event"}`,
      data: event.payload || {},
      ledger: event.ledger,
    });
  });

  // Add resolution step
  if (market.winningOutcome) {
    resolutionTrail.push({
      step: resolutionTrail.length + 1,
      description: `Market resolved: "${market.winningOutcome}"`,
      data: { winningOutcome: market.winningOutcome },
      timestamp: new Date(market.resolutionTime).toISOString(),
    });
  }

  const didWin = market.winningOutcome === prediction.outcome;

  return {
    prediction: {
      id: prediction.id,
      marketId: prediction.marketId,
      outcome: prediction.outcome,
      amount: prediction.amount,
      result: prediction.result,
      createdAt: new Date(prediction.createdAt).toISOString(),
    },
    market: {
      id: market.id,
      question: market.question,
      winningOutcome: market.winningOutcome,
      status: market.status,
      resolutionTime: new Date(market.resolutionTime).toISOString(),
    },
    resolutionTrail,
    computation: {
      predictedOutcome: prediction.outcome,
      winningOutcome: market.winningOutcome,
      didWin,
    },
  };
}