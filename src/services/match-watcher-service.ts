import { and, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { groupMatches, matchEvents, matches, matchStates } from "../db/schema";
import type { TxLineClient } from "../txline/client";
import type { NormalizedScoreState } from "../txline/types";
import type { MatchPollJob, PollMatchJob, WorkerEnv } from "../env";
import { newId } from "../utils/ids";
import { formatKickoff } from "../utils/dates";
import { CommentaryService } from "./commentary-service";
import { LeaderboardService } from "./leaderboard-service";
import { TelegramMessageSender } from "../bot/message-sender";
import { log } from "../utils/logger";

type Db = ReturnType<typeof createDb>;

export class MatchWatcherService {
  private readonly commentary: CommentaryService;
  private readonly leaderboard: LeaderboardService;
  private readonly sender: TelegramMessageSender;

  constructor(private readonly db: Db, private readonly txline: TxLineClient, env: WorkerEnv) {
    this.commentary = new CommentaryService(env.TELEGRAM_BOT_USERNAME);
    this.leaderboard = new LeaderboardService(db);
    this.sender = new TelegramMessageSender(env);
  }

  async enqueueActiveMatches(queue: Queue<MatchPollJob>) {
    const activeMatches = await this.listActiveMatches();
    await Promise.all(activeMatches.map((match) => queue.send({
      kind: "poll_match",
      matchId: match.id,
      txlineFixtureId: match.txlineFixtureId
    })));
  }

  async pollActiveMatches(queue?: Queue<MatchPollJob>) {
    const activeMatches = await this.listActiveMatches();
    for (const match of activeMatches) {
      try {
        await this.poll({
          kind: "poll_match",
          matchId: match.id,
          txlineFixtureId: match.txlineFixtureId
        }, queue);
      } catch (error) {
        log("error", "active match poll failed", {
          matchId: match.id,
          txlineFixtureId: match.txlineFixtureId,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  }

  private async listActiveMatches() {
    const rows = await this.db
      .select({ id: matches.id, txlineFixtureId: matches.txlineFixtureId })
      .from(groupMatches)
      .innerJoin(matches, eq(groupMatches.matchId, matches.id))
      .where(eq(groupMatches.status, "active"));

    return [...new Map(rows.map((row) => [row.id, row])).values()];
  }

  async poll(job: PollMatchJob, queue?: Queue<MatchPollJob>) {
    const [match] = await this.db.select().from(matches).where(eq(matches.id, job.matchId)).limit(1);
    if (!match) {
      return;
    }
    const activeGroupMatches = await this.db
      .select()
      .from(groupMatches)
      .where(and(eq(groupMatches.matchId, job.matchId), eq(groupMatches.status, "active")));
    if (activeGroupMatches.length === 0) {
      return;
    }

    const previous = await this.db.select().from(matchStates).where(eq(matchStates.matchId, job.matchId)).limit(1);
    const next = isDemoMatch(match)
      ? demoScoreSnapshot(match.txlineFixtureId, match.startTime)
      : await this.txline.getScoreSnapshot(job.txlineFixtureId);
    await this.upsertState(job.matchId, next);

    const previousState = previous[0] ?? null;
    const changedScore = previousState
      ? previousState.participant1Score !== next.participant1Score || previousState.participant2Score !== next.participant2Score
      : next.participant1Score !== 0 || next.participant2Score !== 0;
    const final = isFinalState(next);
    const matchStarted = !final && isMatchStarted(match.startTime, next);
    const anyStarted = matchStarted && activeGroupMatches.some((groupMatch) => groupMatch.predictionsOpen === 1);
    if (!anyStarted && !changedScore && !final) {
      return;
    }

    if (anyStarted) {
      await this.db.insert(matchEvents).values({
        id: newId("match_event"),
        matchId: job.matchId,
        eventType: "match_started",
        payload: JSON.stringify(next),
        txlineReference: next.seq ? String(next.seq) : null,
        verified: next.confirmed ? 1 : 0
      });
    }
    if (changedScore || final) {
      await this.db.insert(matchEvents).values({
        id: newId("match_event"),
        matchId: job.matchId,
        eventType: final ? "full_time" : "score_change",
        payload: JSON.stringify(next),
        txlineReference: next.seq ? String(next.seq) : null,
        verified: next.confirmed ? 1 : 0
      });
    }

    for (const groupMatch of activeGroupMatches) {
      await this.notifyGroup({ groupMatch, match, previousState, next, changedScore, final, matchStarted, queue });
    }
  }

  private async notifyGroup(params: {
    groupMatch: typeof groupMatches.$inferSelect;
    match: typeof matches.$inferSelect;
    previousState: typeof matchStates.$inferSelect | null;
    next: NormalizedScoreState;
    changedScore: boolean;
    final: boolean;
    matchStarted: boolean;
    queue?: Queue<MatchPollJob>;
  }) {
    const { groupMatch, match, previousState, next, changedScore, final, matchStarted, queue } = params;
    const started = groupMatch.predictionsOpen === 1 && matchStarted;
    if (!started && !changedScore && !final) {
      return;
    }

    const groupId = groupMatch.groupId.replace("telegram_group_", "");
    if (started) {
      await this.db.update(groupMatches).set({ predictionsOpen: 0, updatedAt: new Date().toISOString() }).where(eq(groupMatches.id, groupMatch.id));
      await this.safeSendHumanized(groupId, this.commentary.matchStarted({
        participant1: match.participant1,
        participant2: match.participant2,
        state: next.displayState ?? next.gameState
      }), { kind: "match_started" });
    }

    const entries = await this.leaderboard.calculate(groupMatch.id, match.id, groupMatch.baselineOddsSummary);
    if (changedScore || final) {
      await this.safeSendHumanized(groupId, this.commentary.matchChange({
        participant1: match.participant1,
        participant2: match.participant2,
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
        participant1: match.participant1,
        participant2: match.participant2,
        participant1Score: next.participant1Score,
        participant2Score: next.participant2Score
      });
      if (winnerMessage) {
        await this.safeSendHumanized(groupId, winnerMessage, { kind: "match_winner" });
      }
      const perfectEntries = entries.filter((entry) => entry.perfect);
      if (perfectEntries.length === 1) {
        await this.safeSendHumanized(groupId, this.commentary.perfectPickWinner(perfectEntries[0]), { kind: "perfect_pick_winner", parseMode: "HTML" });
      }
      if (perfectEntries.length === 0) {
        await queue?.send({ kind: "no_perfect_pick_follow_up", groupId: groupMatch.groupId }, { delaySeconds: 300 });
      }
    }
    if (changedScore || final) {
      await this.safeSendHumanized(groupId, this.commentary.leaderboardUpdate(entries, final), { kind: final ? "final_leaderboard" : "leaderboard_update", parseMode: "HTML" });
    }

    if (final) {
      await this.db.update(groupMatches).set({ status: "final", predictionsOpen: 0, updatedAt: new Date().toISOString() }).where(eq(groupMatches.id, groupMatch.id));
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
    await this.safeSendHumanized(groupId.replace("telegram_group_", ""), text, { kind: "no_perfect_pick_follow_up" });
  }

  private async sendHumanized(chatId: string, draft: string, options: { kind: string; parseMode?: "HTML" }) {
    await this.sender.sendMessage(chatId, draft, {
      parseMode: options.parseMode,
      formatContext: { kind: options.kind }
    });
  }

  private async safeSendHumanized(chatId: string, draft: string, options: { kind: string; parseMode?: "HTML" }) {
    try {
      await this.sendHumanized(chatId, draft, options);
    } catch (error) {
      log("error", "telegram match update send failed", {
        chatId,
        kind: options.kind,
        error: error instanceof Error ? error.message : "Unknown error"
      });
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

function isMatchStarted(startTime: string, score: { gameState?: string; displayState?: string }) {
  const state = `${score.gameState ?? ""} ${score.displayState ?? ""}`.toLowerCase();
  if (/\b(live|in[_ -]?play|started|kick[_ -]?off|first half|second half|1h|2h|half[_ -]?time|ht)\b/.test(state)) {
    return true;
  }

  const kickoff = new Date(startTime).getTime();
  return Number.isFinite(kickoff) && Date.now() >= kickoff;
}

function isFinalState(score: { gameState?: string; displayState?: string }) {
  const state = `${score.gameState ?? ""} ${score.displayState ?? ""}`.toLowerCase();
  return /\b(full|final|ft|full[_ -]?time|ended|complete|completed)\b/.test(state);
}

function isDemoMatch(match: typeof matches.$inferSelect) {
  return match.id === "demo_match_brazil_france" || match.txlineFixtureId === 9000001;
}

function demoScoreSnapshot(fixtureId: number, startTime: string): NormalizedScoreState {
  const kickoff = new Date(startTime).getTime();
  const elapsedMs = Date.now() - kickoff;
  if (!Number.isFinite(kickoff) || elapsedMs < 0) {
    return {
      fixtureId,
      gameState: "scheduled",
      displayState: "Kickoff soon",
      participant1Score: 0,
      participant2Score: 0,
      confirmed: true,
      timestamp: Date.now(),
      raw: { demo: true, phase: "scheduled" }
    };
  }

  if (elapsedMs < 60_000) {
    return {
      fixtureId,
      gameState: "live",
      displayState: "1H",
      participant1Score: 0,
      participant2Score: 0,
      confirmed: true,
      seq: 1,
      timestamp: Date.now(),
      raw: { demo: true, phase: "kickoff" }
    };
  }

  if (elapsedMs < 120_000) {
    return {
      fixtureId,
      gameState: "live",
      displayState: "23'",
      participant1Score: 1,
      participant2Score: 0,
      confirmed: true,
      seq: 2,
      timestamp: Date.now(),
      raw: { demo: true, phase: "first_goal" }
    };
  }

  if (elapsedMs < 180_000) {
    return {
      fixtureId,
      gameState: "live",
      displayState: "67'",
      participant1Score: 1,
      participant2Score: 1,
      confirmed: true,
      seq: 3,
      timestamp: Date.now(),
      raw: { demo: true, phase: "equalizer" }
    };
  }

  return {
    fixtureId,
    gameState: "final",
    displayState: "Full-time",
    participant1Score: 2,
    participant2Score: 1,
    confirmed: true,
    seq: 4,
    timestamp: Date.now(),
    raw: { demo: true, phase: "full_time" }
  };
}
