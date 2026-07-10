import { createDb } from "../db/client";
import type { MatchPollJob, WorkerEnv } from "../env";
import { MatchWatcherService } from "../services/match-watcher-service";
import { TxLineClient } from "../txline/client";
import { log } from "../utils/logger";

export async function consumeMatchPoll(batch: MessageBatch<MatchPollJob>, env: WorkerEnv) {
  const watcher = new MatchWatcherService(createDb(env), new TxLineClient(env), env);
  for (const message of batch.messages) {
    try {
      if (message.body.kind === "no_perfect_pick_follow_up") {
        await watcher.sendNoPerfectPickFollowUp(message.body.groupId);
      } else {
        await watcher.poll(message.body, env.MATCH_POLL_QUEUE);
      }
      message.ack();
    } catch (error) {
      log("error", "match poll queue job failed", {
        body: message.body,
        error: error instanceof Error ? error.message : "Unknown error"
      });
      message.retry();
    }
  }
}
