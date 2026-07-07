import { eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { users } from "../db/schema";

type Db = ReturnType<typeof createDb>;

export class UserService {
  constructor(private readonly db: Db) {}

  async upsertTelegramUser(input: { telegramUserId: string; username?: string; displayName?: string }) {
    const id = `telegram_user_${input.telegramUserId}`;
    await this.db.insert(users).values({
      id,
      platform: "telegram",
      platformUserId: input.telegramUserId,
      username: input.username ?? null,
      displayName: input.displayName ?? null
    }).onConflictDoUpdate({
      target: users.platformUserId,
      set: {
        username: input.username ?? null,
        displayName: input.displayName ?? null,
        updatedAt: new Date().toISOString()
      }
    });
    const [user] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  }
}
