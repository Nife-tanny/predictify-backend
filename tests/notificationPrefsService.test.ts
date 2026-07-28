import {
  getNotificationPreferences,
  isNotificationChannelEnabled,
  patchNotificationPreferences,
  type NotificationPrefsRepository,
} from "../src/services/notificationPrefs";

function makeRepo(
  seed: Array<{
    userId: string;
    category: "market_resolved" | "claim_ready" | "dispute_opened";
    channel: "email" | "webhook";
    enabled: boolean;
  }> = [],
): NotificationPrefsRepository {
  const rows = [...seed];

  return {
    async listByUser(userId) {
      return rows.filter((row) => row.userId === userId);
    },
    async upsertMany(upserts) {
      for (const upsert of upserts) {
        const index = rows.findIndex(
          (row) =>
            row.userId === upsert.userId &&
            row.category === upsert.category &&
            row.channel === upsert.channel,
        );

        if (index >= 0) {
          rows[index] = upsert;
        } else {
          rows.push(upsert);
        }
      }
    },
    async findOne(userId, category, channel) {
      return (
        rows.find(
          (row) =>
            row.userId === userId &&
            row.category === category &&
            row.channel === channel,
        ) ?? null
      );
    },
  };
}

describe("notificationPrefs service", () => {
  it("returns enabled=true for the full category/channel matrix when no rows exist", async () => {
    const repo = makeRepo();

    const preferences = await getNotificationPreferences("user-1", repo);

    expect(preferences).toHaveLength(6);
    expect(preferences.every((row) => row.enabled)).toBe(true);
  });

  it("persists updates and merges them into the returned preference matrix", async () => {
    const repo = makeRepo();

    const preferences = await patchNotificationPreferences(
      "user-1",
      [
        { category: "market_resolved", channel: "email", enabled: false },
        { category: "claim_ready", channel: "webhook", enabled: false },
      ],
      repo,
    );

    expect(
      preferences.find(
        (row) => row.category === "market_resolved" && row.channel === "email",
      ),
    ).toEqual({
      category: "market_resolved",
      channel: "email",
      enabled: false,
    });

    expect(
      preferences.find(
        (row) => row.category === "claim_ready" && row.channel === "webhook",
      ),
    ).toEqual({
      category: "claim_ready",
      channel: "webhook",
      enabled: false,
    });

    expect(
      preferences.find(
        (row) => row.category === "market_resolved" && row.channel === "webhook",
      ),
    ).toEqual({
      category: "market_resolved",
      channel: "webhook",
      enabled: true,
    });
  });

  it("uses the last duplicate update for the same category/channel pair", async () => {
    const repo = makeRepo();

    const preferences = await patchNotificationPreferences(
      "user-1",
      [
        { category: "market_resolved", channel: "email", enabled: false },
        { category: "market_resolved", channel: "email", enabled: true },
      ],
      repo,
    );

    expect(
      preferences.find(
        (row) => row.category === "market_resolved" && row.channel === "email",
      ),
    ).toEqual({
      category: "market_resolved",
      channel: "email",
      enabled: true,
    });
  });

  it("defaults dispatcher checks to enabled when no override exists", async () => {
    const repo = makeRepo();

    await expect(
      isNotificationChannelEnabled("user-1", "claim_ready", "webhook", repo),
    ).resolves.toBe(true);
  });

  it("returns persisted disabled values for dispatcher checks", async () => {
    const repo = makeRepo([
      {
        userId: "user-1",
        category: "claim_ready",
        channel: "webhook",
        enabled: false,
      },
    ]);

    await expect(
      isNotificationChannelEnabled("user-1", "claim_ready", "webhook", repo),
    ).resolves.toBe(false);
  });
});
