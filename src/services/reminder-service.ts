import { and, eq, lte } from "drizzle-orm";
import type { createDb } from "../db/client";
import { matchReminders } from "../db/schema";
import type { WorkerEnv } from "../env";
import type { NormalizedFixture } from "../txline/types";
import { TelegramMessageSender } from "../bot/message-sender";
import { formatKickoff } from "../utils/dates";
import { newId } from "../utils/ids";
import { log } from "../utils/logger";

type Db = ReturnType<typeof createDb>;

export type CreateReminderInput = {
  groupId: string;
  userId?: string;
  requesterUsername?: string | null;
  requesterDisplayName?: string | null;
  fixture: NormalizedFixture;
  offsetMinutes: number;
};

export class ReminderService {
  private readonly sender?: TelegramMessageSender;

  constructor(private readonly db: Db, env?: Pick<WorkerEnv, "TELEGRAM_BOT_TOKEN" | "AI_API_KEY">) {
    this.sender = env ? new TelegramMessageSender(env) : undefined;
  }

  async create(input: CreateReminderInput) {
    const kickoff = new Date(input.fixture.startTime).getTime();
    if (!Number.isFinite(kickoff)) {
      return { kind: "invalid_kickoff" } as const;
    }

    const offsetMinutes = Math.max(1, Math.round(input.offsetMinutes));
    const remindAt = new Date(kickoff - offsetMinutes * 60 * 1000);
    if (remindAt.getTime() <= Date.now()) {
      return { kind: "too_late", remindAt } as const;
    }

    const id = newId("match_reminder");
    await this.db.insert(matchReminders).values({
      id,
      groupId: input.groupId,
      userId: input.userId ?? null,
      requesterUsername: input.requesterUsername ?? null,
      requesterDisplayName: input.requesterDisplayName ?? null,
      txlineFixtureId: input.fixture.fixtureId,
      participant1: input.fixture.participant1,
      participant2: input.fixture.participant2,
      competition: input.fixture.competition ?? null,
      startTime: input.fixture.startTime,
      remindAt: remindAt.toISOString(),
      offsetMinutes,
      status: "pending"
    });

    const [reminder] = await this.db.select().from(matchReminders).where(eq(matchReminders.id, id)).limit(1);
    return { kind: "created", reminder } as const;
  }

  async sendDue(now = new Date()) {
    if (!this.sender) {
      throw new Error("ReminderService.sendDue requires Telegram env");
    }

    const due = await this.db
      .select()
      .from(matchReminders)
      .where(and(eq(matchReminders.status, "pending"), lte(matchReminders.remindAt, now.toISOString())))
      .limit(20);

    for (const reminder of due) {
      const chatId = reminder.groupId.replace("telegram_group_", "");
      try {
        await this.sender.sendMessage(chatId, reminderMessage(reminder), {
          formatContext: { kind: "match_reminder" }
        });
        await this.db.update(matchReminders).set({
          status: "sent",
          sentAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }).where(eq(matchReminders.id, reminder.id));
      } catch (error) {
        log("error", "match reminder send failed", {
          reminderId: reminder.id,
          groupId: reminder.groupId,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  }
}

function reminderMessage(reminder: typeof matchReminders.$inferSelect) {
  const mention = reminder.requesterUsername ? `@${reminder.requesterUsername}` : reminder.requesterDisplayName ?? "Reminder";
  return `${mention} reminder: ${reminder.participant1} vs ${reminder.participant2} kicks off at ${formatKickoff(reminder.startTime)}.`;
}
