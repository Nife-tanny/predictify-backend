# TODO - feature/market-comments

## Planned steps
1. Add DB migration + schema: `drizzle/migrations/0020_comments.sql` and exports in `src/db/schema.ts`.
2. Implement listing logic with cursor pagination (service or repo function) for market comments.
3. Implement route `src/routes/comments.ts` for `GET /api/markets/:id/comments` with validation, pagination, and consistent error envelope.
4. Wire router into `src/index.ts`.
5. Add tests `tests/market-comments.test.ts` covering: basic listing, pagination envelope, invalid query handling, cursor edge cases, and marketId filtering.
6. Update docs/OpenAPI if needed.
7. Run `npm test`, `npm run lint`, and `npm run test:coverage`.

## Progress
- [x] Step 1: DB migration + schema

- [x] Step 2: Cursor pagination listing logic

- [x] Step 3: Route implementation

- [x] Step 4: Wire route

- [x] Step 5: Tests
- [x] Step 6: Docs/OpenAPI
- [x] Step 7: Lint + test + coverage

