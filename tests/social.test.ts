process.env.NODE_ENV = "test";
process.env.PORT = "3001";
process.env.LOG_LEVEL = "fatal";
process.env.DATABASE_URL = "postgres://localhost/test";
process.env.JWT_SECRET = "social-test-secret-at-least-32-bytes-long";
process.env.JWT_ISSUER = "predictify";
process.env.JWT_AUDIENCE = "predictify-app";
process.env.JWT_TTL_SECONDS = "3600";
process.env.STELLAR_NETWORK = "testnet";
process.env.SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
process.env.HORIZON_URL = "https://horizon-testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID = "CABCDEF";

import express from "express";
import request from "supertest";
import type { RequestHandler } from "express";
import { createSocialRouter } from "../src/routes/social";
import { errorHandler } from "../src/middleware/errorHandler";
import { AppError } from "../src/errors";
import type { SocialRepository } from "../src/repositories/socialRepository";

type SocialState = Awaited<ReturnType<SocialRepository["followUser"]>>;

const ACTOR_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TARGET_ADDRESS = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function makeAuthMiddleware(address = ACTOR_ADDRESS): RequestHandler {
  return (req, _res, next) => {
    req.user = {
      id: "actor-user-id",
      stellarAddress: address,
    };
    req.id = "req-social-1" as never;
    next();
  };
}

function makeState(isFollowing: boolean, overrides: Partial<SocialState> = {}): SocialState {
  return {
    targetAddress: TARGET_ADDRESS,
    isFollowing,
    visibility: {
      isPrivate: false,
      feedVisible: true,
    },
    counts: {
      followers: isFollowing ? 1 : 0,
      following: 12,
    },
    ...overrides,
  };
}

function makeApp(repository: SocialRepository, auditLogger = jest.fn().mockResolvedValue("req-social-1")) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/users",
    createSocialRouter({
      repository,
      authMiddleware: makeAuthMiddleware(),
      auditLogger: auditLogger as never,
    }),
  );
  app.use(errorHandler);
  return { app, auditLogger };
}

describe("social follow routes", () => {
  it("follows a public user and writes an audit entry", async () => {
    const repository: SocialRepository = {
      followUser: jest.fn().mockResolvedValue(makeState(true)),
      unfollowUser: jest.fn(),
    };

    const { app, auditLogger } = makeApp(repository);
    const res = await request(app).post(`/api/users/${TARGET_ADDRESS}/follow`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: makeState(true) });
    expect(repository.followUser).toHaveBeenCalledWith(ACTOR_ADDRESS, TARGET_ADDRESS);
    expect(auditLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "social.followed",
        walletAddress: ACTOR_ADDRESS,
        correlationId: "req-social-1",
      }),
    );
  });

  it("unfollows idempotently and returns refreshed cached counts", async () => {
    const repository: SocialRepository = {
      followUser: jest.fn(),
      unfollowUser: jest.fn().mockResolvedValue(makeState(false)),
    };

    const { app, auditLogger } = makeApp(repository);
    const res = await request(app).delete(`/api/users/${TARGET_ADDRESS}/follow`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: makeState(false) });
    expect(repository.unfollowUser).toHaveBeenCalledWith(ACTOR_ADDRESS, TARGET_ADDRESS);
    expect(auditLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "social.unfollowed",
        walletAddress: ACTOR_ADDRESS,
      }),
    );
  });

  it("rejects an invalid Stellar address at the boundary", async () => {
    const repository: SocialRepository = {
      followUser: jest.fn(),
      unfollowUser: jest.fn(),
    };

    const { app } = makeApp(repository);
    const res = await request(app).post("/api/users/not-a-wallet/follow");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_error");
    expect(repository.followUser).not.toHaveBeenCalled();
  });

  it("enforces privacy for private feeds", async () => {
    const repository: SocialRepository = {
      followUser: jest.fn().mockRejectedValue(new AppError("forbidden", "Target user has a private feed", 403)),
      unfollowUser: jest.fn(),
    };

    const { app, auditLogger } = makeApp(repository);
    const res = await request(app).post(`/api/users/${TARGET_ADDRESS}/follow`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "forbidden" } });
    expect(auditLogger).not.toHaveBeenCalled();
  });

  it("returns 404 when the target user does not exist", async () => {
    const repository: SocialRepository = {
      followUser: jest.fn().mockRejectedValue(AppError.notFound("User not found")),
      unfollowUser: jest.fn(),
    };

    const { app } = makeApp(repository);
    const res = await request(app).post(`/api/users/${TARGET_ADDRESS}/follow`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found" } });
  });

  it("rejects self-follow attempts", async () => {
    const repository: SocialRepository = {
      followUser: jest.fn().mockRejectedValue(new AppError("validation_error", "Users cannot follow themselves", 400)),
      unfollowUser: jest.fn(),
    };

    const app = express();
    app.use(express.json());
    app.use(
      "/api/users",
      createSocialRouter({
        repository,
        authMiddleware: makeAuthMiddleware(TARGET_ADDRESS),
        auditLogger: jest.fn() as never,
      }),
    );
    app.use(errorHandler);

    const res = await request(app).post(`/api/users/${TARGET_ADDRESS}/follow`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "validation_error" } });
  });
});
