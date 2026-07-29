import request from "supertest";
import { createApp } from "../../src/index";
import { closeDb } from "../../src/db/client";

// ─────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────

// Mock the queue connection
jest.mock("../../src/queue", () => ({
  redisConnection: {
    status: "ready",
    on: jest.fn(),
    quit: jest.fn(),
  },
}));

// Mock the services
jest.mock("../../src/services/authChallengeService", () => ({
  createChallenge: jest.fn().mockResolvedValue({
    nonce: "test-nonce",
    expiresAt: new Date(Date.now() + 1000 * 60 * 5),
  }),
}));

jest.mock("../../src/services/authVerifyService", () => ({
  verifyChallengeAndIssueJwt: jest.fn().mockResolvedValue({
    ok: true,
    value: {
      accessToken: "access-token-123",
      refreshToken: "refresh-token-123",
      user: { id: "1", stellarAddress: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" },
    },
  }),
}));

jest.mock("../../src/services/refreshTokenService", () => ({
  rotateRefreshToken: jest.fn().mockResolvedValue({
    ok: true,
    value: {
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
    },
  }),
  revokeFamily: jest.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────
// Test Suite
// ─────────────────────────────────────────────────────────────────────────

describe("Integration Test: /api/auth with Zod Validation", () => {
  let app: any;

  const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const INVALID_ADDRESS = "invalid-address";
  const WHITESPACE_ADDRESS = "   ";

  beforeAll(() => {
    app = createApp();
  });

  afterAll(async () => {
    await closeDb();
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/auth/challenge
  // ───────────────────────────────────────────────────────────────────────

  describe("POST /api/auth/challenge", () => {
    describe("validation errors (422)", () => {
      it("returns 422 if stellarAddress is missing", async () => {
        const response = await request(app)
          .post("/api/auth/challenge")
          .send({})
          .expect(422);

        expect(response.body).toHaveProperty("error.type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.stellarAddress");
        expect(response.body.error.fields.stellarAddress).toContain("Stellar address is required");
        expect(response.headers).toHaveProperty("x-request-id");
      });

      it("returns 422 if stellarAddress is null", async () => {
        const response = await request(app)
          .post("/api/auth/challenge")
          .send({ stellarAddress: null })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.stellarAddress");
      });

      it("returns 422 if stellarAddress is not a string", async () => {
        const response = await request(app)
          .post("/api/auth/challenge")
          .send({ stellarAddress: 12345 })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.stellarAddress");
      });

      it("returns 422 if stellarAddress is invalid Stellar address", async () => {
        const response = await request(app)
          .post("/api/auth/challenge")
          .send({ stellarAddress: INVALID_ADDRESS })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.stellarAddress");
        expect(response.body.error.fields.stellarAddress[0]).toContain("Invalid Stellar");
      });

      it("returns 422 if stellarAddress is only whitespace", async () => {
        const response = await request(app)
          .post("/api/auth/challenge")
          .send({ stellarAddress: WHITESPACE_ADDRESS })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.stellarAddress");
      });

      it("returns 422 if extra unknown fields are provided", async () => {
        const response = await request(app)
          .post("/api/auth/challenge")
          .send({ stellarAddress: VALID_ADDRESS, extraField: "should-fail" })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
      });
    });

    describe("success (201)", () => {
      it("returns 201 with nonce if stellarAddress is valid", async () => {
        const response = await request(app)
          .post("/api/auth/challenge")
          .send({ stellarAddress: VALID_ADDRESS })
          .expect(201);

        expect(response.body).toHaveProperty("nonce", "test-nonce");
        expect(response.body).toHaveProperty("expiresAt");
        expect(response.body.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
        expect(response.headers).toHaveProperty("x-request-id");
      });

      it("trims whitespace from stellarAddress", async () => {
        const response = await request(app)
          .post("/api/auth/challenge")
          .send({ stellarAddress: `  ${VALID_ADDRESS}  ` })
          .expect(201);

        expect(response.body).toHaveProperty("nonce");
        expect(response.headers).toHaveProperty("x-request-id");
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/auth/verify
  // ───────────────────────────────────────────────────────────────────────

  describe("POST /api/auth/verify", () => {
    describe("validation errors (422)", () => {
      it("returns 422 if stellarAddress is missing", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            nonce: "test-nonce",
            signature: "test-signature",
          })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.stellarAddress");
      });

      it("returns 422 if nonce is missing", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            stellarAddress: VALID_ADDRESS,
            signature: "test-signature",
          })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.nonce");
      });

      it("returns 422 if signature is missing", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            stellarAddress: VALID_ADDRESS,
            nonce: "test-nonce",
          })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.signature");
      });

      it("returns 422 if stellarAddress is invalid", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            stellarAddress: INVALID_ADDRESS,
            nonce: "test-nonce",
            signature: "test-signature",
          })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.stellarAddress");
      });

      it("returns 422 if nonce is empty string", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            stellarAddress: VALID_ADDRESS,
            nonce: "",
            signature: "test-signature",
          })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.nonce");
        expect(response.body.error.fields.nonce[0]).toContain("non-empty");
      });

      it("returns 422 if signature is empty string", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            stellarAddress: VALID_ADDRESS,
            nonce: "test-nonce",
            signature: "",
          })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.signature");
        expect(response.body.error.fields.signature[0]).toContain("non-empty");
      });

      it("returns 422 if extra unknown fields are provided", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            stellarAddress: VALID_ADDRESS,
            nonce: "test-nonce",
            signature: "test-signature",
            extraField: "should-fail",
          })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
      });
    });

    describe("success (200)", () => {
      it("returns 200 with tokens for valid request", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            stellarAddress: VALID_ADDRESS,
            nonce: "test-nonce",
            signature: "test-signature",
          })
          .expect(200);

        expect(response.body).toHaveProperty("accessToken", "access-token-123");
        expect(response.body).toHaveProperty("refreshToken", "refresh-token-123");
        expect(response.body).toHaveProperty("user");
        expect(response.headers).toHaveProperty("x-request-id");
      });

      it("trims whitespace from all string fields", async () => {
        const response = await request(app)
          .post("/api/auth/verify")
          .send({
            stellarAddress: `  ${VALID_ADDRESS}  `,
            nonce: "  test-nonce  ",
            signature: "  test-signature  ",
          })
          .expect(200);

        expect(response.body).toHaveProperty("accessToken");
        expect(response.headers).toHaveProperty("x-request-id");
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/auth/refresh
  // ───────────────────────────────────────────────────────────────────────

  describe("POST /api/auth/refresh", () => {
    describe("validation errors (422)", () => {
      it("returns 422 if refreshToken is missing", async () => {
        const response = await request(app)
          .post("/api/auth/refresh")
          .send({})
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
        expect(response.body.error.fields.refreshToken).toContain("refreshToken is required");
      });

      it("returns 422 if refreshToken is null", async () => {
        const response = await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: null })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if refreshToken is not a string", async () => {
        const response = await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: 12345 })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if refreshToken is empty string", async () => {
        const response = await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: "" })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if refreshToken is only whitespace", async () => {
        const response = await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: "   " })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if extra unknown fields are provided", async () => {
        const response = await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: "valid-token", extraField: "should-fail" })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
      });
    });

    describe("success (200)", () => {
      it("returns 200 with new tokens if refreshToken is valid", async () => {
        const response = await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: "valid-token" })
          .expect(200);

        expect(response.body).toHaveProperty("accessToken", "new-access-token");
        expect(response.body).toHaveProperty("refreshToken", "new-refresh-token");
        expect(response.headers).toHaveProperty("x-request-id");
      });

      it("trims whitespace from refreshToken", async () => {
        const response = await request(app)
          .post("/api/auth/refresh")
          .send({ refreshToken: "  valid-token  " })
          .expect(200);

        expect(response.body).toHaveProperty("accessToken");
        expect(response.headers).toHaveProperty("x-request-id");
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/auth/logout
  // ───────────────────────────────────────────────────────────────────────

  describe("POST /api/auth/logout", () => {
    describe("validation errors (422)", () => {
      it("returns 422 if refreshToken is missing", async () => {
        const response = await request(app)
          .post("/api/auth/logout")
          .send({})
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if refreshToken is empty string", async () => {
        const response = await request(app)
          .post("/api/auth/logout")
          .send({ refreshToken: "" })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if refreshToken is not a string", async () => {
        const response = await request(app)
          .post("/api/auth/logout")
          .send({ refreshToken: 12345 })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if extra unknown fields are provided", async () => {
        const response = await request(app)
          .post("/api/auth/logout")
          .send({ refreshToken: "valid-token", extraField: "should-fail" })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
      });
    });

    describe("success (204)", () => {
      it("returns 204 No Content if refreshToken is valid", async () => {
        await request(app)
          .post("/api/auth/logout")
          .send({ refreshToken: "valid-token" })
          .expect(204);
      });

      it("returns 204 even with whitespace-padded token", async () => {
        await request(app)
          .post("/api/auth/logout")
          .send({ refreshToken: "  valid-token  " })
          .expect(204);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // POST /api/auth/wallet/logout
  // ───────────────────────────────────────────────────────────────────────

  describe("POST /api/auth/wallet/logout", () => {
    describe("validation errors (422)", () => {
      it("returns 422 if refreshToken is missing", async () => {
        const response = await request(app)
          .post("/api/auth/wallet/logout")
          .send({})
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if refreshToken is empty string", async () => {
        const response = await request(app)
          .post("/api/auth/wallet/logout")
          .send({ refreshToken: "" })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if refreshToken is not a string", async () => {
        const response = await request(app)
          .post("/api/auth/wallet/logout")
          .send({ refreshToken: 12345 })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
        expect(response.body.error).toHaveProperty("fields.refreshToken");
      });

      it("returns 422 if extra unknown fields are provided", async () => {
        const response = await request(app)
          .post("/api/auth/wallet/logout")
          .send({ refreshToken: "valid-token", extraField: "should-fail" })
          .expect(422);

        expect(response.body.error).toHaveProperty("type", "ValidationError");
      });
    });

    describe("success (204)", () => {
      it("returns 204 No Content if refreshToken is valid", async () => {
        await request(app)
          .post("/api/auth/wallet/logout")
          .send({ refreshToken: "valid-token" })
          .expect(204);
      });

      it("returns 204 even with whitespace-padded token", async () => {
        await request(app)
          .post("/api/auth/wallet/logout")
          .send({ refreshToken: "  valid-token  " })
          .expect(204);
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Error response structure validation
  // ───────────────────────────────────────────────────────────────────────

  describe("Error Response Structure", () => {
    it("includes correlationId in all error responses", async () => {
      const response = await request(app)
        .post("/api/auth/challenge")
        .send({ stellarAddress: INVALID_ADDRESS })
        .expect(422);

      expect(response.body.error).toHaveProperty("correlationId");
      expect(response.body.error.correlationId).toMatch(/^[a-zA-Z0-9-]+$/);
    });

    it("includes code and message in validation errors", async () => {
      const response = await request(app)
        .post("/api/auth/challenge")
        .send({})
        .expect(422);

      expect(response.body.error).toHaveProperty("code");
      expect(response.body.error).toHaveProperty("message");
      expect(response.body.error).toHaveProperty("fields");
    });

    it("includes fields object for validation errors", async () => {
      const response = await request(app)
        .post("/api/auth/verify")
        .send({ stellarAddress: INVALID_ADDRESS })
        .expect(422);

      expect(response.body.error).toHaveProperty("fields");
      expect(typeof response.body.error.fields).toBe("object");
    });
  });
});
        .expect(204);
    });
  });

  describe("POST /api/auth/wallet/logout", () => {
    it("returns 400 if refreshToken is missing", async () => {
      const response = await request(app)
        .post("/api/auth/wallet/logout")
        .send({})
        .expect(400);

      expect(response.body.error).toHaveProperty("type", "BadRequest");
      expect(response.headers).toHaveProperty("x-request-id");
    });

    it("returns 204 if valid token provided", async () => {
      await request(app)
        .post("/api/auth/wallet/logout")
        .send({ refreshToken: "valid-token" })
        .expect(204);
    });
  });
});
