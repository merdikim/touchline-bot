import { createApp } from "./app";
import { createDb } from "./db/client";
import type { MatchPollJob, WorkerEnv } from "./env";
import { consumeMatchPoll } from "./queue/match-poll-consumer";
import { MatchWatcherService } from "./services/match-watcher-service";
import { TxLineClient } from "./txline/client";

const app = createApp();

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext) {
    const watcher = new MatchWatcherService(createDb(env), new TxLineClient(env), env);
    ctx.waitUntil(watcher.enqueueActiveMatches(env.MATCH_POLL_QUEUE));
  },

  async queue(batch: MessageBatch<MatchPollJob>, env: WorkerEnv) {
    await consumeMatchPoll(batch, env);
  }
};
