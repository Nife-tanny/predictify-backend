import request from 'supertest';
import express from 'express';
import { featureFlagsRouter } from '../src/routes/featureFlags';

jest.mock('../src/services/featureFlags', () => ({
  getAllFlags: jest.fn().mockReturnValue([
    { id: 'MAINTENANCE_MODE', enabled: false, variant: null, description: 'System maintenance' },
    { id: 'NEW_MARKET_FLOW', enabled: true, variant: 'v2', description: 'Beta feature' },
  ]),
}));

const app = express();
app.use(express.json());
app.use('/feature-flags', featureFlagsRouter);

describe('GET /feature-flags', () => {
  it('should return 200 OK with formatted feature flags map', async () => {
    const res = await request(app).get('/feature-flags');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      MAINTENANCE_MODE: { enabled: false, variant: null },
      NEW_MARKET_FLOW: { enabled: true, variant: 'v2' },
    });
    expect(res.body).toHaveProperty('correlationId');
  });

  it('should pass correlation ID in headers and response body', async () => {
    const correlationId = 'test-uuid-123';
    const res = await request(app)
      .get('/feature-flags')
      .set('x-correlation-id', correlationId);

    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe(correlationId);
    expect(res.headers['x-correlation-id']).toBe(correlationId);
  });
});
