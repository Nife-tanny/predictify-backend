# Users API

## `GET /api/users`

Returns a cursor-paginated list of registered users, ordered newest-first
(`createdAt DESC, id DESC`).

### Query Parameters

| Parameter | Type   | Required | Default | Constraints  | Description                                                    |
|-----------|--------|----------|---------|--------------|----------------------------------------------------------------|
| `limit`   | number | no       | `20`    | 1-100        | Number of rows to return per page.                             |
| `cursor`  | string | no       | --      | opaque token | Cursor from the previous page's `nextCursor`. Absent = page 1. |

### Pagination

This endpoint uses **keyset (cursor) pagination** on `(createdAt DESC, id DESC)`.

- Pass the returned `nextCursor` verbatim as `?cursor=` to fetch the next page.
- `nextCursor` is `null` on the last page.
- Cursors are versioned. A stale or tampered cursor is safely ignored (the
  response restarts from page 1) rather than causing a 500 or a wrong offset.

### Response

`200 OK`

```json
{
  "data": [
    {
      "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "stellarAddress": "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
      "createdAt": "2026-06-27T12:00:00.000Z"
    }
  ],
  "nextCursor": "djF8MjR8..."
}
```

### Errors

- `400 validation_error` - invalid query parameters

### Conditional requests and caching

`GET /api/users` supports strong ETags for conditional revalidation. Every
successful response includes an `ETag` header and `Cache-Control: no-cache`.
Clients may send an `If-None-Match` header with the latest ETag to receive a
`304 Not Modified` response without a body when the page has not changed.

Example:

```http
GET /api/users
If-None-Match: "<etag>"
```

## `GET /api/users/me`

Returns the authenticated user's own profile. Requires a valid JWT.

Supports strong ETag / `304` conditional GET on the `{ data: profile }` payload.

## `GET /api/users/:address/predictions`

Returns a cursor-paginated list of predictions for the given Stellar address.

### Query Parameters

| Parameter | Type   | Required | Default | Constraints                                      | Description                         |
|-----------|--------|----------|---------|--------------------------------------------------|-------------------------------------|
| `status`  | string | no       | --      | `pending`/`confirmed`/`won`/`lost`/`claimed`     | Filter by prediction status.        |
| `limit`   | number | no       | `20`    | 1-100                                            | Page size.                          |
| `cursor`  | string | no       | --      | opaque token                                     | Cursor from previous `nextCursor`.  |

Supports strong ETag / `304` conditional GET on the `{ data, nextCursor }` payload.

### Errors

- `400 invalid_address` — path param is not a valid G… Stellar address
- `400 validation_error` — query params fail validation
- `404 not_found` — no user row for that address

## `GET /api/users/:stellarAddress/profile`

Returns the public profile for any Stellar address.

Supports strong ETag / `304` conditional GET on the `{ data: profile }` payload.

### Errors

- `400 validation_error` — invalid Stellar address
- `404 not_found` — no matching user row
