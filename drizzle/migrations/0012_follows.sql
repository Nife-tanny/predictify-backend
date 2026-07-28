ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followers_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS user_follows (
  follower_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, target_user_id),
  CONSTRAINT user_follows_no_self_follow CHECK (follower_user_id <> target_user_id)
);

CREATE INDEX IF NOT EXISTS user_follows_target_idx ON user_follows (target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_follows_follower_idx ON user_follows (follower_user_id, created_at DESC);

WITH follower_counts AS (
  SELECT target_user_id AS user_id, COUNT(*)::integer AS followers_count
  FROM user_follows
  GROUP BY target_user_id
),
following_counts AS (
  SELECT follower_user_id AS user_id, COUNT(*)::integer AS following_count
  FROM user_follows
  GROUP BY follower_user_id
)
UPDATE users AS u
SET followers_count = COALESCE(fc.followers_count, 0),
    following_count = COALESCE(gc.following_count, 0)
FROM follower_counts AS fc
FULL OUTER JOIN following_counts AS gc ON fc.user_id = gc.user_id
WHERE u.id = COALESCE(fc.user_id, gc.user_id);
