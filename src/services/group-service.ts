import { and, count, desc, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { botMessages, groupMatches, groups, matches } from "../db/schema";
import { newId } from "../utils/ids";

type Db = ReturnType<typeof createDb>;

export class GroupService {
  constructor(private readonly db: Db) {}

  async upsertTelegramGroup(input: { telegramGroupId: string; title?: string | null }) {
    const id = `telegram_group_${input.telegramGroupId}`;
    await this.db.insert(groups).values({
      id,
      platform: "telegram",
      platformGroupId: input.telegramGroupId,
      title: input.title ?? null
    }).onConflictDoUpdate({
      target: groups.platformGroupId,
      set: { title: input.title ?? null, updatedAt: new Date().toISOString() }
    });
    const [group] = await this.db.select().from(groups).where(eq(groups.id, id)).limit(1);
    return group;
  }

  async loadContext(groupId: string) {
    const [group] = await this.db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
    const activeGroupMatches = await this.db
      .select({ groupMatch: groupMatches, match: matches })
      .from(groupMatches)
      .innerJoin(matches, eq(groupMatches.matchId, matches.id))
      .where(and(eq(groupMatches.groupId, groupId), eq(groupMatches.status, "active")))
      .orderBy(desc(groupMatches.createdAt));
    const active = activeGroupMatches[0];

    return {
      group,
      activeGroupMatches,
      activeGroupMatch: active?.groupMatch ?? null,
      activeMatch: active?.match ?? null
    };
  }

  async setLatestBotPrompt(groupId: string, prompt: string) {
    await this.db.update(groups).set({ latestBotPrompt: prompt, updatedAt: new Date().toISOString() }).where(eq(groups.id, groupId));
  }

  async rememberBotMessage(input: { groupId: string; telegramMessageId?: string; messageType: string; payload?: unknown }) {
    await this.db.insert(botMessages).values({
      id: newId("bot_message"),
      groupId: input.groupId,
      telegramMessageId: input.telegramMessageId ?? null,
      messageType: input.messageType,
      payload: input.payload ? JSON.stringify(input.payload) : null
    });
    return input;
  }

  async countBotMessages(input: { groupId: string; messageType: string }) {
    const [row] = await this.db
      .select({ total: count() })
      .from(botMessages)
      .where(and(eq(botMessages.groupId, input.groupId), eq(botMessages.messageType, input.messageType)));
    return row?.total ?? 0;
  }

  newGroupMatchId() {
    return newId("group_match");
  }
}
