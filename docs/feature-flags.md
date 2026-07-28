# Feature Flags

The Feature Flag service provides a fast, cached flag evaluation mechanism backed by Postgres. 

## Cache Invalidation Strategy
To ensure flag evaluations are highly performant (e.g. they don't add latency to typical requests), the flags are stored in an in-memory `Map` within the Node process. 

The strategy is:
1. On application startup, all feature flags are loaded from the database into memory.
2. A background `setInterval` polling loop runs every `FLAGS_CACHE_TTL_SECONDS` (default: 30 seconds) to fetch the latest state from the database.
3. If the background fetch fails, the error is logged and the stale cache is retained to prevent the application from crashing or losing flag evaluations.
4. Any mutation via the Admin API (`POST`, `PATCH`, `DELETE`) immediately writes through to Postgres and updates the local cache instance. This ensures read-after-write consistency for the writer. Other horizontally scaled nodes will pick up the change within the polling window.

## Configuration
- `FLAGS_CACHE_TTL_SECONDS`: Polling interval in seconds (default: 30)

## API Endpoints (Public)

- `GET /api/feature-flags` — List active feature flags.
  - Query: `cursor` (optional), `limit` (optional, default 20, max 100)
  - Response: `{ items: Array<{ id, enabled, variant }>, next_cursor: string | null, total: number }`
  - `next_cursor` is `null` on the last page. Pass it verbatim as `?cursor=` to fetch the next page.

## API Endpoints (Admin Only)

All endpoints require the `Authorization` header with a valid admin JWT. The endpoints are rate-limited per admin token.

- `GET /api/admin/feature-flags` - List all flags.
- `GET /api/admin/feature-flags/:key` - Get a single flag. Returns 404 if not found.
- `POST /api/admin/feature-flags` - Create a new flag.
  - Body: `{ key: string, enabled: boolean, variant?: string, description?: string }`
- `PATCH /api/admin/feature-flags/:key` - Partially update a flag.
  - Body: `{ enabled?: boolean, variant?: string, description?: string }`
- `DELETE /api/admin/feature-flags/:key` - Delete a flag.
