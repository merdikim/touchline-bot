import { and, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { groupMatches, matchEvents, matches, matchStates } from "../db/schema";
import type { TxLineClient } from "../txline/client";
import type { MatchPollJob, WorkerEnv } from "../env";
import { newId } from "../utils/ids";
import { CommentaryService } from "./commentary-service";
import { LeaderboardService } from "./leaderboard-service";
import { TelegramMessageSender } from "../bot/message-sender";

type Db = ReturnType<typeof createDb>;

export class MatchWatcherService {
  private readonly commentary = new CommentaryService();
  private readonly leaderboard: LeaderboardService;
  private readonly sender: TelegramMessageSender;

  constructor(private readonly db: Db, private readonly txline: TxLineClient, env: WorkerEnv) {
    this.leaderboard = new LeaderboardService(db);
    this.sender = new TelegramMessageSender(env);
  }

  async enqueueActiveMatches(queue: Queue<MatchPollJob>) {
    const rows = await this.db
      .select({ groupMatch: groupMatches, match: matches })
      .from(groupMatches)
      .innerJoin(matches, eq(groupMatches.matchId, matches.id))
      .where(and(eq(groupMatches.status, "active")));

    await Promise.all(rows.map((row) => queue.send({
      groupMatchId: row.groupMatch.id,
      matchId: row.match.id,
      txlineFixtureId: row.match.txlineFixtureId
    })));
  }

  async poll(job: MatchPollJob) {
    const [row] = await this.db
      .select({ groupMatch: groupMatches, match: matches })
      .from(groupMatches)
      .innerJoin(matches, eq(groupMatches.matchId, matches.id))
      .where(eq(groupMatches.id, job.groupMatchId))
      .limit(1);
    if (!row) {
      return;
    }

    const previous = await this.db.select().from(matchStates).where(eq(matchStates.matchId, job.matchId)).limit(1);
    const next = await this.txline.getScoreSnapshot(job.txlineFixtureId);
    await this.upsertState(job.matchId, next);

    const changedScore = !previous[0] || previous[0].participant1Score !== next.participant1Score || previous[0].participant2Score !== next.participant2Score;
    const final = /full|final|ft/i.test(next.gameState ?? "");
    if (!changedScore && !final) {
      return;
    }

    await this.db.insert(matchEvents).values({
      id: newId("match_event"),
      matchId: job.matchId,
      eventType: final ? "full_time" : "score_change",
      payload: JSON.stringify(next),
      txlineReference: next.seq ? String(next.seq) : null,
      verified: next.confirmed ? 1 : 0
    });

    const entries = await this.leaderboard.calculate(job.groupMatchId, job.matchId, row.groupMatch.baselineOddsSummary);
    const text = final
      ? this.commentary.finalRecap({ participant1: row.match.participant1, participant2: row.match.participant2, p1: next.participant1Score, p2: next.participant2Score, entries })
      : this.commentary.goalUpdate({ participant1: row.match.participant1, participant2: row.match.participant2, p1: next.participant1Score, p2: next.participant2Score, leader: entries[0]?.displayName });

    const groupId = row.groupMatch.groupId.replace("telegram_group_", "");
    await this.sender.sendMessage(groupId, text);

    if (final) {
      await this.db.update(groupMatches).set({ status: "final", predictionsOpen: 0, updatedAt: new Date().toISOString() }).where(eq(groupMatches.id, job.groupMatchId));
    }
  }

  private async upsertState(matchId: string, score: { gameState?: string; displayState?: string; participant1Score: number; participant2Score: number; seq?: number; timestamp?: number; confirmed?: boolean; raw: unknown }) {
    await this.db.insert(matchStates).values({
      id: newId("match_state"),
      matchId,
      gameState: score.gameState ?? null,
      displayState: score.displayState ?? null,
      participant1Score: score.participant1Score,
      participant2Score: score.participant2Score,
      latestSeq: score.seq ?? null,
      latestTxlineTs: score.timestamp ?? null,
      confirmed: score.confirmed ? 1 : 0,
      rawScoreSnapshot: JSON.stringify(score.raw)
    }).onConflictDoUpdate({
      target: matchStates.matchId,
      set: {
        gameState: score.gameState ?? null,
        displayState: score.displayState ?? null,
        participant1Score: score.participant1Score,
        participant2Score: score.participant2Score,
        latestSeq: score.seq ?? null,
        latestTxlineTs: score.timestamp ?? null,
        confirmed: score.confirmed ? 1 : 0,
        rawScoreSnapshot: JSON.stringify(score.raw),
        updatedAt: new Date().toISOString()
      }
    });
  }
}
