import { createApp } from "./app";
import { createDb } from "./db/client";
import type { MatchPollJob, WorkerEnv } from "./env";
import { consumeMatchPoll } from "./queue/match-poll-consumer";
import { MatchWatcherService } from "./services/match-watcher-service";
import { ReminderService } from "./services/reminder-service";
import { TxLineClient } from "./txline/client";

const app = createApp();

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext) {
    const db = createDb(env);
    const watcher = new MatchWatcherService(db, new TxLineClient(env), env);
    const reminders = new ReminderService(db, env);
    ctx.waitUntil(Promise.all([
      watcher.pollActiveMatches(env.MATCH_POLL_QUEUE),
      reminders.sendDue()
    ]));
  },

  async queue(batch: MessageBatch<MatchPollJob>, env: WorkerEnv) {
    await consumeMatchPoll(batch, env);
  }
};
