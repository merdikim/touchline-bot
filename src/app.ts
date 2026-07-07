import { Hono } from "hono";
import { createDb } from "./db/client";
import type { AppEnv, MatchPollJob } from "./env";
import { createTelegramBot } from "./bot/telegram";
import { MatchWatcherService } from "./services/match-watcher-service";
import { TxLineClient } from "./txline/client";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/webhooks/telegram", async (c) => {
    const env = c.env;
    const bot = createTelegramBot(env, createDb(env));
    await bot.init();
    await bot.handleUpdate(await c.req.json());
    return c.json({ ok: true });
  });

  app.post("/internal/poll-match", async (c) => {
    const env = c.env;
    const db = createDb(env);
    const watcher = new MatchWatcherService(db, new TxLineClient(env), env);
    const body = await c.req.json<Partial<MatchPollJob>>().catch((): Partial<MatchPollJob> => ({}));
    if (body.groupMatchId && body.matchId && body.txlineFixtureId) {
      await watcher.poll(body as MatchPollJob);
    } else {
      await watcher.enqueueActiveMatches(env.MATCH_POLL_QUEUE);
    }
    return c.json({ ok: true });
  });

  return app;
}
