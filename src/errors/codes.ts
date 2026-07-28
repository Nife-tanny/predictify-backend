export const ErrorCodes = {
  INTERNAL_ERROR: "internal_error",
  NOT_FOUND: "not_found",
  VALIDATION_ERROR: "validation_error",
  REQUEST_FAILED: "request_failed",
  UNAUTHORIZED: "unauthorized",
  CONFLICT: "conflict",
  FORBIDDEN: "forbidden",
  MARKET_CLOSED: "market_closed",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
