import { Bot, type Context } from "grammy";
import { eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { groupMatches, matches, matchStates, oddsSnapshots } from "../db/schema";
import type { WorkerEnv } from "../env";
import { IntentRouter } from "../ai/intent-router";
import type { MatchRef } from "../ai/intent-schema";
import { TxLineClient } from "../txline/client";
import type { NormalizedFixture } from "../txline/types";
import { GroupService } from "../services/group-service";
import { UserService } from "../services/user-service";
import { MatchService } from "../services/match-service";
import { PredictionService } from "../services/prediction-service";
import { LeaderboardService } from "../services/leaderboard-service";
import { CommentaryService } from "../services/commentary-service";
import { VerificationService } from "../services/verification-service";
import { displayName } from "./formatters";
import { formatKickoff } from "../utils/dates";
import { newId } from "../utils/ids";
import { log } from "../utils/logger";

type Db = ReturnType<typeof createDb>;

export function createTelegramBot(env: WorkerEnv, db: Db) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  const txline = new TxLineClient(env);
  const groups = new GroupService(db);
  const users = new UserService(db);
  const matchesService = new MatchService(db, txline);
  const predictions = new PredictionService(db);
  const leaderboard = new LeaderboardService(db);
  const commentary = new CommentaryService();
  const verification = new VerificationService(db);
  const router = new IntentRouter(env);

  bot.on("message:text", async (ctx) => {
    const message = ctx.message;
    const chat = message.chat;

    if (chat.type === "private") {
      await ctx.reply("Invite me into a group and mention me to get started!");
      return;
    }

    const botMentioned = message.text.toLowerCase().includes(`@${env.TELEGRAM_BOT_USERNAME.toLowerCase()}`);
    const replyToBot = message.reply_to_message?.from?.username?.toLowerCase() === env.TELEGRAM_BOT_USERNAME.toLowerCase();

    if (!replyToBot && !botMentioned) {
      console.log("message is not a reply and does not mention the bot. No action taken");
      return;
    }

    const routedText = stripBotMention(message.text, env.TELEGRAM_BOT_USERNAME);
    const group = await groups.upsertTelegramGroup({ telegramGroupId: String(chat.id), title: "title" in chat ? chat.title : null });
    const user = message.from ? await users.upsertTelegramUser({
      telegramUserId: String(message.from.id),
      username: message.from.username,
      displayName: displayName(message.from)
    }) : null;
    const context = await groups.loadContext(group.id);

    const intent = await router.route({
      text: routedText,
      replyToBot,
      predictionsOpen: context.activeGroupMatch?.predictionsOpen === 1,
      latestBotPrompt: context.group?.latestBotPrompt,
      activeMatch: context.activeMatch ? { participant1: context.activeMatch.participant1, participant2: context.activeMatch.participant2 } : null
    });

    console.log('intent', intent)

    try {
      await handleIntent(ctx, {
        db,
        env,
        groupId: group.id,
        userId: user?.id,
        userDisplayName: user?.displayName ?? displayName(message.from),
        text: routedText,
        intent,
        context,
        txline,
        groups,
        matchesService,
        predictions,
        leaderboard,
        commentary,
        verification
      });
    } catch (error) {
      log("error", "telegram intent failed", { error: error instanceof Error ? error.message : "Unknown error", intent: intent.intent });
      await ctx.reply("I hit a snag reading the match data. Try me again in a moment.");
    }
  });

  return bot;
}

function stripBotMention(text: string, botUsername: string) {
  const escapedUsername = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`@${escapedUsername}\\b`, "gi"), "")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleIntent(
  ctx: Context,
  deps: {
    db: Db;
    env: WorkerEnv;
    groupId: string;
    userId?: string;
    userDisplayName: string;
    text: string;
    intent: Awaited<ReturnType<IntentRouter["route"]>>;
    context: Awaited<ReturnType<GroupService["loadContext"]>>;
    txline: TxLineClient;
    groups: GroupService;
    matchesService: MatchService;
    predictions: PredictionService;
    leaderboard: LeaderboardService;
    commentary: CommentaryService;
    verification: VerificationService;
  }
) {
  const active = deps.context.activeGroupMatch && deps.context.activeMatch
    ? { groupMatch: deps.context.activeGroupMatch, match: deps.context.activeMatch }
    : null;

  if (deps.intent.intent === "create_group_match") {
    const selection = await deps.matchesService.createGroupMatch(deps.groupId, matchQueryFromRef(deps.intent.match) ?? deps.text);
    if (selection.kind === "none") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.noMatch());
      return;
    }
    if (selection.kind === "ambiguous") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.ambiguous(selection.fixtures.map((fixture) => ({
        participant1: fixture.participant1,
        participant2: fixture.participant2,
        competition: fixture.competition,
        startTime: formatKickoff(fixture.startTime)
      }))));
      return;
    }
    const text = deps.commentary.createdMatch({
      participant1: selection.match.participant1,
      participant2: selection.match.participant2,
      competition: selection.match.competition,
      kickoff: formatKickoff(selection.match.startTime)
    });
    await replyAndRemember(ctx, deps.groups, deps.groupId, text);
    return;
  }

  if (deps.intent.intent === "run_demo") {
    const match = await createDemoMatch(deps.db, deps.groupId);
    const text = deps.commentary.createdMatch({ participant1: match.participant1, participant2: match.participant2, competition: match.competition, kickoff: formatKickoff(match.startTime) });
    await replyAndRemember(ctx, deps.groups, deps.groupId, `${text}\n\nDemo mode is ready, so judges can submit picks right now.`);
    return;
  }

  if (deps.intent.intent === "get_available_matches") {
    const fixtures = await deps.txline.getFixtures();
    const text = fixtures.slice(0, 20).map((fixture, index) => {
      const details = [fixture.competition, formatKickoff(fixture.startTime)].filter(Boolean).join(", ");
      return `${index + 1}. ${fixture.participant1} vs ${fixture.participant2}${details ? ` (${details})` : ""}`;
    }).join("\n") || "No fixtures returned by TxLINE right now.";
    await replyAndRemember(ctx, deps.groups, deps.groupId, text);
    return;
  }

  if (deps.intent.intent === "get_match_status") {
    const target = await resolveScoreTarget(deps.intent.match, active, deps.txline);
    if (target.kind === "none") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, deps.intent.match.team1 || deps.intent.match.team2 ? deps.commentary.noMatch() : "Mention me with a fixture first, like: @touchline what's the score for Brazil vs France");
      return;
    }
    if (target.kind === "ambiguous") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.ambiguous(target.fixtures.map((fixture) => ({
        participant1: fixture.participant1,
        participant2: fixture.participant2,
        competition: fixture.competition,
        startTime: formatKickoff(fixture.startTime)
      }))));
      return;
    }

    const score = await deps.txline.getScoreSnapshot(target.fixtureId);
    if (target.matchId) {
      await upsertScoreState(deps.db, target.matchId, score);
    }
    await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.status({
      participant1: target.participant1,
      participant2: target.participant2,
      competition: target.competition,
      participant1Score: score.participant1Score,
      participant2Score: score.participant2Score,
      state: score.displayState ?? score.gameState,
      confirmed: score.confirmed
    }));
    return;
  }

  if (deps.intent.intent === "unclear") {
    await replyAndRemember(ctx, deps.groups, deps.groupId, deps.intent.clarificationQuestion ?? "Do you want a demo, a leaderboard, a prediction, or the score?");
    return;
  }

  if (deps.intent.intent === "smalltalk") {
    await replyAndRemember(ctx, deps.groups, deps.groupId, "I'm here. Give me a fixture and I'll run the leaderboard.");
    return;
  }

  if (!active) {
    await replyAndRemember(ctx, deps.groups, deps.groupId, "Mention me with a fixture first, like: @touchline create a leaderboard for Brazil vs France");
    return;
  }

  if (deps.intent.intent === "submit_prediction") {
    if (!deps.userId) {
      await ctx.reply("I need a Telegram user to lock that prediction.");
      return;
    }
    const result = await deps.predictions.submit({
      groupMatchId: active.groupMatch.id,
      userId: deps.userId,
      match: active.match,
      rawPrediction: deps.intent.prediction?.raw || deps.text
    });
    const text = result.ok
      ? deps.commentary.predictionLocked({ displayName: deps.userDisplayName, participant1: active.match.participant1, participant2: active.match.participant2, score: `${result.prediction.participant1Score}-${result.prediction.participant2Score}` })
      : result.reason;
    await replyAndRemember(ctx, deps.groups, deps.groupId, text);
    return;
  }

  if (deps.intent.intent === "get_leaderboard") {
    const entries = await deps.leaderboard.calculate(active.groupMatch.id, active.match.id, active.groupMatch.baselineOddsSummary);
    await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.leaderboard(entries));
    return;
  }

  if (deps.intent.intent === "get_odds_commentary") {
    const odds = await deps.txline.getOddsSnapshot(active.match.txlineFixtureId, undefined, active.match.participant1, active.match.participant2);
    await deps.db.insert(oddsSnapshots).values({
      id: newId("odds"),
      matchId: active.match.id,
      txlineTs: Date.now(),
      summary: JSON.stringify(odds),
      rawOddsSnapshot: JSON.stringify(odds.raw)
    });
    await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.odds(odds));
    return;
  }

  if (deps.intent.intent === "get_verification") {
    await replyAndRemember(ctx, deps.groups, deps.groupId, await deps.verification.summarize(active.match.id));
    return;
  }

  await replyAndRemember(ctx, deps.groups, deps.groupId, "Mention me with a fixture first, like: @touchline create a leaderboard for Brazil vs France");
}

async function replyAndRemember(ctx: Context, groups: GroupService, groupId: string, text: string) {
  await ctx.reply(text);
  await groups.setLatestBotPrompt(groupId, text);
}

function matchQueryFromRef(match: MatchRef) {
  const teams = [match.team1, match.team2].filter((team): team is string => Boolean(team));
  return teams.length > 0 ? teams.join(" vs ") : null;
}

function normalizeTeamName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchRefMatchesFixture(match: MatchRef, fixture: Pick<NormalizedFixture, "participant1" | "participant2">) {
  const requested = [match.team1, match.team2].filter((team): team is string => Boolean(team)).map(normalizeTeamName);
  if (requested.length === 0) {
    return true;
  }

  const participants = [fixture.participant1, fixture.participant2].map(normalizeTeamName);
  return requested.every((team) => participants.some((participant) => participant.includes(team) || team.includes(participant)));
}

function selectFixture(fixtures: NormalizedFixture[], match: MatchRef) {
  if (fixtures.length <= 1) {
    return fixtures[0] ?? null;
  }

  const ranked = fixtures
    .map((fixture) => ({
      fixture,
      score: [match.team1, match.team2]
        .filter((team): team is string => Boolean(team))
        .reduce((total, team) => total + (matchRefMatchesFixture({ team1: team, team2: null }, fixture) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0] || ranked[0].score === 0 || ranked[0].score === ranked[1]?.score) {
    return null;
  }
  return ranked[0].fixture;
}

async function resolveScoreTarget(
  match: MatchRef,
  active: { groupMatch: typeof groupMatches.$inferSelect; match: typeof matches.$inferSelect } | null,
  txline: TxLineClient
): Promise<
  | { kind: "selected"; fixtureId: number; participant1: string; participant2: string; competition?: string | null; matchId?: string }
  | { kind: "ambiguous"; fixtures: NormalizedFixture[] }
  | { kind: "none" }
> {
  const query = matchQueryFromRef(match);
  if (!query) {
    return active
      ? { kind: "selected", fixtureId: active.match.txlineFixtureId, participant1: active.match.participant1, participant2: active.match.participant2, competition: active.match.competition, matchId: active.match.id }
      : { kind: "none" };
  }

  if (active && matchRefMatchesFixture(match, active.match)) {
    return { kind: "selected", fixtureId: active.match.txlineFixtureId, participant1: active.match.participant1, participant2: active.match.participant2, competition: active.match.competition, matchId: active.match.id };
  }

  const fixtures = await txline.getFixtures();
  const selected = selectFixture(fixtures, match);
  if (!selected) {
    return fixtures.length > 1 ? { kind: "ambiguous", fixtures: fixtures.slice(0, 5) } : { kind: "none" };
  }

  return { kind: "selected", fixtureId: selected.fixtureId, participant1: selected.participant1, participant2: selected.participant2, competition: selected.competition };
}

async function upsertScoreState(db: Db, matchId: string, score: { gameState?: string; displayState?: string; participant1Score: number; participant2Score: number; seq?: number; timestamp?: number; confirmed?: boolean; raw: unknown }) {
  await db.insert(matchStates).values({
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

async function createDemoMatch(db: Db, groupId: string) {
  const matchId = "demo_match_brazil_france";
  const kickoff = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await db.insert(matches).values({
    id: matchId,
    txlineFixtureId: 9000001,
    competitionId: 1,
    competition: "Touchline Demo",
    participant1: "Brazil",
    participant2: "France",
    participant1IsHome: 1,
    startTime: kickoff,
    status: "scheduled",
    rawFixture: JSON.stringify({ demo: true })
  }).onConflictDoUpdate({
    target: matches.txlineFixtureId,
    set: { startTime: kickoff, updatedAt: new Date().toISOString() }
  });
  await db.update(groupMatches).set({ status: "archived", updatedAt: new Date().toISOString() }).where(eq(groupMatches.groupId, groupId));
  await db.insert(groupMatches).values({
    id: newId("group_match"),
    groupId,
    matchId,
    status: "active",
    predictionsOpen: 1,
    baselineOddsSummary: JSON.stringify({ favorite: "Brazil", underdog: "France", movement: "stable", confidence: "medium", raw: { demo: true } })
  });
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  return match;
}
