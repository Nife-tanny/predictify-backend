import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { notificationPreferences } from "../db/schema";

export const notificationCategories = [
  "market_resolved",
  "claim_ready",
  "dispute_opened",
] as const;

export const notificationChannels = ["email", "webhook"] as const;

export type NotificationCategory = (typeof notificationCategories)[number];
export type NotificationChannel = (typeof notificationChannels)[number];

export interface NotificationPreference {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface NotificationPreferenceRow extends NotificationPreference {
  userId: string;
  updatedAt?: Date;
}

export interface NotificationPrefsRepository {
  listByUser(userId: string): Promise<NotificationPreferenceRow[]>;
  upsertMany(rows: NotificationPreferenceRow[]): Promise<void>;
  findOne(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
  ): Promise<NotificationPreferenceRow | null>;
}

export const notificationPrefsRepository: NotificationPrefsRepository = {
  async listByUser(userId) {
    const rows = await db
      .select({
        userId: notificationPreferences.userId,
        category: notificationPreferences.category,
        channel: notificationPreferences.channel,
        enabled: notificationPreferences.enabled,
        updatedAt: notificationPreferences.updatedAt,
      })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId));
    return rows as NotificationPreferenceRow[];
  },

  async upsertMany(rows) {
    for (const row of rows) {
      await db
        .insert(notificationPreferences)
        .values({
          userId: row.userId,
          category: row.category,
          channel: row.channel,
          enabled: row.enabled,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.userId,
            notificationPreferences.category,
            notificationPreferences.channel,
          ],
          set: {
            enabled: row.enabled,
            updatedAt: new Date(),
          },
        });
    }
  },

  async findOne(userId, category, channel) {
    const rows = await db
      .select({
        userId: notificationPreferences.userId,
        category: notificationPreferences.category,
        channel: notificationPreferences.channel,
        enabled: notificationPreferences.enabled,
        updatedAt: notificationPreferences.updatedAt,
      })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.category, category),
          eq(notificationPreferences.channel, channel),
        ),
      )
      .limit(1);

    return (rows[0] ?? null) as NotificationPreferenceRow | null;
  },
};

function buildCompleteMatrix(
  rows: NotificationPreferenceRow[],
): NotificationPreference[] {
  const rowMap = new Map(
    rows.map((row) => [`${row.category}:${row.channel}`, row.enabled] as const),
  );

  return notificationCategories.flatMap((category) =>
    notificationChannels.map((channel) => ({
      category,
      channel,
      enabled: rowMap.get(`${category}:${channel}`) ?? true,
    })),
  );
}

export async function getNotificationPreferences(
  userId: string,
  repo: NotificationPrefsRepository = notificationPrefsRepository,
): Promise<NotificationPreference[]> {
  const rows = await repo.listByUser(userId);
  return buildCompleteMatrix(rows);
}

export async function patchNotificationPreferences(
  userId: string,
  updates: NotificationPreference[],
  repo: NotificationPrefsRepository = notificationPrefsRepository,
): Promise<NotificationPreference[]> {
  const deduped = new Map<string, NotificationPreference>();
  for (const update of updates) {
    deduped.set(`${update.category}:${update.channel}`, update);
  }

  await repo.upsertMany(
    Array.from(deduped.values()).map((update) => ({
      userId,
      category: update.category,
      channel: update.channel,
      enabled: update.enabled,
    })),
  );

  return getNotificationPreferences(userId, repo);
}

export async function isNotificationChannelEnabled(
  userId: string,
  category: NotificationCategory,
  channel: NotificationChannel,
  repo: NotificationPrefsRepository = notificationPrefsRepository,
): Promise<boolean> {
  const row = await repo.findOne(userId, category, channel);
  return row?.enabled ?? true;
}
