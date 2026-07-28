process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "a".repeat(32);
process.env.SOROBAN_RPC_URL = "https://rpc.testnet.stellar.org";
process.env.HORIZON_URL = "https://horizon.testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID = "CABC...";

import {
  RouteError,
  Result,
  ok,
  err,
  isRouteError,
  HTTP_STATUS,
  ErrorEnvelope,
} from "../src/errors/RouteError";

describe("RouteError discriminated union", () => {
  describe("ok()", () => {
    it("returns a Result with ok: true and value", () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it("works with objects", () => {
      const value = { id: "123", name: "test" };
      const result = ok(value);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(value);
      }
    });
  });

  describe("err()", () => {
    it("returns a Result with ok: false and error", () => {
      const error: RouteError = { kind: "NotFound", message: "Not found" };
      const result = err(error);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual(error);
      }
    });

    it("returns never type for type safety", () => {
      const error: RouteError = { kind: "Unauthorized", message: "Unauthorized" };
      const result: Result<never> = err(error);
      expect(result.ok).toBe(false);
    });
  });

  describe("isRouteError()", () => {
    it("returns true for valid RouteError objects", () => {
      const errors: RouteError[] = [
        { kind: "NotFound", message: "not found" },
        { kind: "Unauthorized", message: "unauthorized" },
        { kind: "Forbidden", message: "forbidden" },
        { kind: "ValidationError", message: "validation failed" },
        { kind: "Conflict", message: "conflict" },
        { kind: "InternalError", message: "internal error" },
        { kind: "BadRequest", message: "bad request" },
      ];

      errors.forEach((error) => {
        expect(isRouteError(error)).toBe(true);
      });
    });

    it("returns false for non-RouteError objects", () => {
      expect(isRouteError(null)).toBe(false);
      expect(isRouteError(undefined)).toBe(false);
      expect(isRouteError({})).toBe(false);
      expect(isRouteError({ message: "error" })).toBe(false);
      expect(isRouteError(new Error("error"))).toBe(false);
      expect(isRouteError("error")).toBe(false);
      expect(isRouteError(123)).toBe(false);
    });

    it("returns true for objects with kind property", () => {
      const obj = { kind: "NotFound", message: "not found" };
      expect(isRouteError(obj)).toBe(true);
    });
  });

  describe("HTTP_STATUS mapping", () => {
    it("maps all RouteError kinds to correct HTTP status codes", () => {
      expect(HTTP_STATUS.NotFound).toBe(404);
      expect(HTTP_STATUS.Unauthorized).toBe(401);
      expect(HTTP_STATUS.Forbidden).toBe(403);
      expect(HTTP_STATUS.ValidationError).toBe(422);
      expect(HTTP_STATUS.Conflict).toBe(409);
      expect(HTTP_STATUS.InternalError).toBe(500);
      expect(HTTP_STATUS.BadRequest).toBe(400);
    });

    it("has exhaustive coverage of all RouteError kinds", () => {
      const kinds: Array<RouteError["kind"]> = [
        "NotFound",
        "Unauthorized",
        "Forbidden",
        "ValidationError",
        "Conflict",
        "InternalError",
        "BadRequest",
      ];

      kinds.forEach((kind) => {
        expect(HTTP_STATUS[kind]).toBeDefined();
        expect(typeof HTTP_STATUS[kind]).toBe("number");
      });
    });
  });

  describe("RouteError variants", () => {
    it("NotFound supports optional resource field", () => {
      const error1: RouteError = { kind: "NotFound", message: "not found" };
      const error2: RouteError = { kind: "NotFound", message: "not found", resource: "User" };
      expect(error1.kind).toBe("NotFound");
      expect(error2.kind).toBe("NotFound");
      if (error2.kind === "NotFound") {
        expect(error2.resource).toBe("User");
      }
    });

    it("Unauthorized only requires message", () => {
      const error: RouteError = { kind: "Unauthorized", message: "invalid token" };
      expect(error.kind).toBe("Unauthorized");
      expect(error.message).toBe("invalid token");
    });

    it("Forbidden supports optional reason field", () => {
      const error: RouteError = {
        kind: "Forbidden",
        message: "forbidden",
        reason: "insufficient permissions",
      };
      expect(error.kind).toBe("Forbidden");
      if (error.kind === "Forbidden") {
        expect(error.reason).toBe("insufficient permissions");
      }
    });

    it("ValidationError supports optional fields map", () => {
      const error: RouteError = {
        kind: "ValidationError",
        message: "validation failed",
        fields: { email: ["invalid format"] },
      };
      expect(error.kind).toBe("ValidationError");
      if (error.kind === "ValidationError") {
        expect(error.fields).toEqual({ email: ["invalid format"] });
      }
    });

    it("Conflict supports optional resource field", () => {
      const error: RouteError = {
        kind: "Conflict",
        message: "resource already exists",
        resource: "prediction",
      };
      expect(error.kind).toBe("Conflict");
      if (error.kind === "Conflict") {
        expect(error.resource).toBe("prediction");
      }
    });

    it("InternalError supports optional cause field", () => {
      const cause = new Error("database connection failed");
      const error: RouteError = {
        kind: "InternalError",
        message: "internal error",
        cause,
      };
      expect(error.kind).toBe("InternalError");
      if (error.kind === "InternalError") {
        expect(error.cause).toBe(cause);
      }
    });

    it("BadRequest supports optional detail field", () => {
      const error: RouteError = {
        kind: "BadRequest",
        message: "bad request",
        detail: "missing required field: id",
      };
      expect(error.kind).toBe("BadRequest");
      if (error.kind === "BadRequest") {
        expect(error.detail).toBe("missing required field: id");
      }
    });
  });

  describe("Result type discrimination", () => {
    it("distinguishes success from error in exhaustive match", () => {
      const successResult: Result<string> = ok("success");
      const errorResult: Result<string> = err({ kind: "NotFound", message: "not found" });

      // Exhaustive match pattern
      if (successResult.ok) {
        expect(successResult.value).toBe("success");
      } else {
        fail("should not be error result");
      }

      if (errorResult.ok) {
        fail("should be error result");
      } else {
        expect(errorResult.error.kind).toBe("NotFound");
      }
    });
  });

  describe("ErrorEnvelope shape", () => {
    it("includes code, message, and correlationId", () => {
      const envelope: ErrorEnvelope = {
        code: "NotFound",
        message: "Resource not found",
        correlationId: "123e4567-e89b-12d3-a456-426614174000",
      };
      expect(envelope.code).toBe("NotFound");
      expect(envelope.message).toBe("Resource not found");
      expect(envelope.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("optionally includes fields for ValidationError", () => {
      const envelope: ErrorEnvelope = {
        code: "ValidationError",
        message: "Validation failed",
        correlationId: "123",
        fields: { email: ["invalid format"], password: ["too short"] },
      };
      expect(envelope.fields).toEqual({
        email: ["invalid format"],
        password: ["too short"],
      });
    });
  });
});
