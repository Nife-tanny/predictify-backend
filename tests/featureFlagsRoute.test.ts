import request from 'supertest';
import express from 'express';
import { featureFlagsRouter } from '../src/routes/feature-flags';
import { errorHandler } from '../src/middleware/errorHandler';

jest.mock('../src/services/featureFlags', () => ({
  getAllFlags: jest.fn().mockReturnValue([
    { id: 'MAINTENANCE_MODE', enabled: false, variant: null, description: 'System maintenance' },
    { id: 'NEW_MARKET_FLOW', enabled: true, variant: 'v2', description: 'Beta feature' },
    { id: 'OLD_CHECKOUT', enabled: false, variant: 'v1', description: 'Legacy checkout' },
  ]),
}));

const app = express();
app.use(express.json());
app.use('/feature-flags', featureFlagsRouter);
app.use(errorHandler);

describe('GET /feature-flags', () => {
  it('should return 200 OK with items, next_cursor, and total envelope', async () => {
    const res = await request(app).get('/feature-flags');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('next_cursor');
    expect(res.body).toHaveProperty('total');
    expect(res.body.total).toBe(3);
    expect(res.body.items).toEqual([
      { id: 'OLD_CHECKOUT', enabled: false, variant: 'v1' },
      { id: 'NEW_MARKET_FLOW', enabled: true, variant: 'v2' },
      { id: 'MAINTENANCE_MODE', enabled: false, variant: null },
    ]);
    expect(res.body.next_cursor).toBeNull();
  });

  it('should return x-correlation-id header', async () => {
    const correlationId = 'test-uuid-123';
    const res = await request(app)
      .get('/feature-flags')
      .set('x-correlation-id', correlationId);

    expect(res.status).toBe(200);
    expect(res.headers['x-correlation-id']).toBe(correlationId);
  });

  it('should return 200 OK when valid query parameters are provided', async () => {
    const res = await request(app)
      .get('/feature-flags')
      .query({ environment: 'development', clientVersion: '1.0.0' });

    expect(res.status).toBe(200);
    expect(res.body.items).toBeDefined();
    expect(res.body.total).toBe(3);
  });

  it('should return 422 Unprocessable Entity when invalid query parameters are provided', async () => {
    const res = await request(app)
      .get('/feature-flags')
      .query({ environment: 'invalid-env' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('validation_error');
    expect(res.body.error.message).toBe('Invalid query parameters');
  });

  it('should paginate with limit', async () => {
    const res = await request(app)
      .get('/feature-flags')
      .query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.next_cursor).not.toBeNull();
    expect(typeof res.body.next_cursor).toBe('string');
  });

  it('should return next_cursor as null on the last page', async () => {
    const first = await request(app)
      .get('/feature-flags')
      .query({ limit: 2 });

    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.next_cursor).not.toBeNull();

    const second = await request(app)
      .get('/feature-flags')
      .query({ cursor: first.body.next_cursor, limit: 2 });

    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();
  });

  it('should restart from page one when cursor is tampered', async () => {
    const res = await request(app)
      .get('/feature-flags')
      .query({ cursor: 'invalid-cursor-token', limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.next_cursor).not.toBeNull();
  });
});
