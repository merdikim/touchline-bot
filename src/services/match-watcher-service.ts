import { and, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { groupMatches, matchEvents, matches, matchStates } from "../db/schema";
import type { TxLineClient } from "../txline/client";
import type { MatchPollJob, PollMatchJob, WorkerEnv } from "../env";
import { newId } from "../utils/ids";
import { formatKickoff } from "../utils/dates";
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
      kind: "poll_match",
      groupMatchId: row.groupMatch.id,
      matchId: row.match.id,
      txlineFixtureId: row.match.txlineFixtureId
    })));
  }

  async poll(job: PollMatchJob, queue?: Queue<MatchPollJob>) {
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

    const previousState = previous[0] ?? null;
    const changedScore = Boolean(previousState && (previousState.participant1Score !== next.participant1Score || previousState.participant2Score !== next.participant2Score));
    const final = /full|final|ft/i.test(next.gameState ?? "");
    const started = row.groupMatch.predictionsOpen === 1 && !final && isMatchStarted(row.match.startTime, next);
    if (!started && !changedScore && !final) {
      return;
    }

    const groupId = row.groupMatch.groupId.replace("telegram_group_", "");
    if (started) {
      await this.db.insert(matchEvents).values({
        id: newId("match_event"),
        matchId: job.matchId,
        eventType: "match_started",
        payload: JSON.stringify(next),
        txlineReference: next.seq ? String(next.seq) : null,
        verified: next.confirmed ? 1 : 0
      });
      await this.db.update(groupMatches).set({ predictionsOpen: 0, updatedAt: new Date().toISOString() }).where(eq(groupMatches.id, job.groupMatchId));
      await this.sendHumanized(groupId, this.commentary.matchStarted({
        participant1: row.match.participant1,
        participant2: row.match.participant2,
        state: next.displayState ?? next.gameState
      }), { kind: "match_started" });
    }

    const entries = await this.leaderboard.calculate(job.groupMatchId, job.matchId, row.groupMatch.baselineOddsSummary);
    if (changedScore || final) {
      await this.db.insert(matchEvents).values({
        id: newId("match_event"),
        matchId: job.matchId,
        eventType: final ? "full_time" : "score_change",
        payload: JSON.stringify(next),
        txlineReference: next.seq ? String(next.seq) : null,
        verified: next.confirmed ? 1 : 0
      });
      await this.sendHumanized(groupId, this.commentary.matchChange({
        participant1: row.match.participant1,
        participant2: row.match.participant2,
        previous: previousState,
        next: {
          participant1Score: next.participant1Score,
          participant2Score: next.participant2Score,
          state: next.displayState ?? next.gameState,
          confirmed: next.confirmed
        },
        final
      }), { kind: final ? "full_time" : "score_change" });
    }
    if (final) {
      const winnerMessage = this.commentary.matchWinner({
        participant1: row.match.participant1,
        participant2: row.match.participant2,
        participant1Score: next.participant1Score,
        participant2Score: next.participant2Score
      });
      if (winnerMessage) {
        await this.sendHumanized(groupId, winnerMessage, { kind: "match_winner" });
      }
      const perfectEntries = entries.filter((entry) => entry.perfect);
      if (perfectEntries.length === 1) {
        await this.sendHumanized(groupId, this.commentary.perfectPickWinner(perfectEntries[0]), { kind: "perfect_pick_winner", parseMode: "HTML" });
      }
      if (perfectEntries.length === 0) {
        await queue?.send({ kind: "no_perfect_pick_follow_up", groupId: row.groupMatch.groupId }, { delaySeconds: 300 });
      }
    }
    if (changedScore || final) {
      await this.sendHumanized(groupId, this.commentary.leaderboardUpdate(entries, final), { kind: final ? "final_leaderboard" : "leaderboard_update" });
    }

    if (final) {
      await this.db.update(groupMatches).set({ status: "final", predictionsOpen: 0, updatedAt: new Date().toISOString() }).where(eq(groupMatches.id, job.groupMatchId));
    }
  }

  async sendNoPerfectPickFollowUp(groupId: string) {
    const fixtures = await this.txline.getFixtures();
    const text = this.commentary.moreMatchesToTry(fixtures.slice(0, 5).map((fixture) => ({
      participant1: fixture.participant1,
      participant2: fixture.participant2,
      competition: fixture.competition ?? null,
      kickoff: formatKickoff(fixture.startTime)
    })));
    await this.sendHumanized(groupId.replace("telegram_group_", ""), text, { kind: "no_perfect_pick_follow_up" });
  }

  private async sendHumanized(chatId: string, draft: string, options: { kind: string; parseMode?: "HTML" }) {
    await this.sender.sendMessage(chatId, draft, {
      parseMode: options.parseMode,
      formatContext: { kind: options.kind }
    });
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

function isMatchStarted(startTime: string, score: { gameState?: string; displayState?: string }) {
  const state = `${score.gameState ?? ""} ${score.displayState ?? ""}`.toLowerCase();
  if (/\b(live|in[_ -]?play|started|kick[_ -]?off|first half|second half|1h|2h|half[_ -]?time|ht)\b/.test(state)) {
    return true;
  }

  const kickoff = new Date(startTime).getTime();
  return Number.isFinite(kickoff) && Date.now() >= kickoff;
}
