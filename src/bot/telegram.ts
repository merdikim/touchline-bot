import { Bot, type Context } from "grammy";
import { and, eq } from "drizzle-orm";
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
type ActiveGroupMatchRow = {
  groupMatch: typeof groupMatches.$inferSelect;
  match: typeof matches.$inferSelect;
};
type MatchOption = Pick<typeof matches.$inferSelect, "participant1" | "participant2" | "competition" | "startTime">;

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

  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    if (chat.type === "private" || !joinedChat(update.old_chat_member.status, update.new_chat_member.status)) {
      return;
    }

    const group = await groups.upsertTelegramGroup({ telegramGroupId: String(chat.id), title: "title" in chat ? chat.title : null });
    await replyAndRemember(ctx, groups, group.id, commentary.groupIntro(), "group_intro");
  });

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
      predictionsOpen: context.activeGroupMatches.some((row) => row.groupMatch.predictionsOpen === 1),
      latestBotPrompt: context.group?.latestBotPrompt,
      activeMatch: context.activeMatch ? { participant1: context.activeMatch.participant1, participant2: context.activeMatch.participant2 } : null,
      activeMatches: context.activeGroupMatches.map((row) => ({ participant1: row.match.participant1, participant2: row.match.participant2 }))
    });

    console.log(intent)

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

function joinedChat(oldStatus: string, newStatus: string) {
  return (oldStatus === "left" || oldStatus === "kicked") && (newStatus === "member" || newStatus === "administrator");
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
  const activeGroupMatches = deps.context.activeGroupMatches;

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
    const target = await resolveScoreTarget(deps.intent.match, activeGroupMatches, deps.txline);
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
    const smalltalkCount = await deps.groups.countBotMessages({ groupId: deps.groupId, messageType: "smalltalk" });
    if (smalltalkCount >= 2) {
      await replyAndRemember(ctx, deps.groups, deps.groupId, gamesOnlyResponse(), "smalltalk_limit");
      return;
    }
    await replyAndRemember(ctx, deps.groups, deps.groupId, conciseSmalltalkResponse(deps.intent.smalltalkResponse), "smalltalk");
    return;
  }

  if (deps.intent.intent === "submit_prediction") {
    if (!deps.userId) {
      await ctx.reply("I need a Telegram user to lock that prediction.");
      return;
    }
    const target = resolveActiveGroupMatchTarget(deps.intent.match, activeGroupMatches);
    if (target.kind === "none") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, "Mention me with a fixture first, like: @touchline create a leaderboard for Brazil vs France");
      return;
    }
    if (target.kind === "ambiguous") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, activeMatchClarification(target.matches));
      return;
    }
    const result = await deps.predictions.submit({
      groupMatchId: target.groupMatch.id,
      userId: deps.userId,
      match: target.match,
      rawPrediction: deps.intent.prediction?.raw || deps.text
    });
    const text = result.ok
      ? deps.commentary.predictionLocked({ displayName: deps.userDisplayName, participant1: target.match.participant1, participant2: target.match.participant2, score: `${result.prediction.participant1Score}-${result.prediction.participant2Score}` })
      : result.reason;
    await replyAndRemember(ctx, deps.groups, deps.groupId, text);
    return;
  }

  if (deps.intent.intent === "get_leaderboard") {
    const target = resolveActiveGroupMatchTarget(deps.intent.match, activeGroupMatches);
    if (target.kind === "none") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, "Mention me with a fixture first, like: @touchline create a leaderboard for Brazil vs France");
      return;
    }
    if (target.kind === "ambiguous") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, activeMatchClarification(target.matches));
      return;
    }
    const entries = await deps.leaderboard.calculate(target.groupMatch.id, target.match.id, target.groupMatch.baselineOddsSummary);
    await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.leaderboard(entries));
    return;
  }

  if (deps.intent.intent === "get_odds_commentary") {
    const target = resolveActiveGroupMatchTarget(deps.intent.match, activeGroupMatches);
    if (target.kind === "none") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, "Mention me with a fixture first, like: @touchline create a leaderboard for Brazil vs France");
      return;
    }
    if (target.kind === "ambiguous") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, activeMatchClarification(target.matches));
      return;
    }
    const odds = await deps.txline.getOddsSnapshot(target.match.txlineFixtureId, undefined, target.match.participant1, target.match.participant2);
    await deps.db.insert(oddsSnapshots).values({
      id: newId("odds"),
      matchId: target.match.id,
      txlineTs: Date.now(),
      summary: JSON.stringify(odds),
      rawOddsSnapshot: JSON.stringify(odds.raw)
    });
    await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.odds(odds));
    return;
  }

  if (deps.intent.intent === "get_verification") {
    const target = resolveActiveGroupMatchTarget(deps.intent.match, activeGroupMatches);
    if (target.kind === "none") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, "Mention me with a fixture first, like: @touchline create a leaderboard for Brazil vs France");
      return;
    }
    if (target.kind === "ambiguous") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, activeMatchClarification(target.matches));
      return;
    }
    await replyAndRemember(ctx, deps.groups, deps.groupId, await deps.verification.summarize(target.match.id));
    return;
  }

  await replyAndRemember(ctx, deps.groups, deps.groupId, "Mention me with a fixture first, like: @touchline create a leaderboard for Brazil vs France");
}

async function replyAndRemember(ctx: Context, groups: GroupService, groupId: string, text: string, messageType?: string) {
  const message = await ctx.reply(text);
  await groups.setLatestBotPrompt(groupId, text);
  if (messageType) {
    await groups.rememberBotMessage({
      groupId,
      telegramMessageId: String(message.message_id),
      messageType,
      payload: { text }
    });
  }
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

function resolveActiveGroupMatchTarget(
  match: MatchRef,
  activeGroupMatches: ActiveGroupMatchRow[]
):
  | ({ kind: "selected" } & ActiveGroupMatchRow)
  | { kind: "ambiguous"; matches: MatchOption[] }
  | { kind: "none" } {
  const query = matchQueryFromRef(match);
  if (!query) {
    if (activeGroupMatches.length === 0) {
      return { kind: "none" };
    }
    if (activeGroupMatches.length === 1) {
      return { kind: "selected", ...activeGroupMatches[0] };
    }
    return { kind: "ambiguous", matches: activeGroupMatches.map((row) => row.match) };
  }

  const matchesForRef = activeGroupMatches.filter((row) => matchRefMatchesFixture(match, row.match));
  if (matchesForRef.length === 0) {
    return { kind: "none" };
  }
  if (matchesForRef.length === 1) {
    return { kind: "selected", ...matchesForRef[0] };
  }
  return { kind: "ambiguous", matches: matchesForRef.map((row) => row.match) };
}

function activeMatchClarification(matches: MatchOption[]) {
  const options = matches.map((match, index) => {
    const details = [match.competition, formatKickoff(match.startTime)].filter(Boolean).join(", ");
    return `${index + 1}. ${match.participant1} vs ${match.participant2}${details ? ` (${details})` : ""}`;
  }).join("\n");
  return `Which leaderboard do you mean?\n\n${options}\n\nMention me with the teams, like: @touchline leaderboard for Brazil vs France`;
}

function conciseSmalltalkResponse(response?: string | null) {
  const fallback = "I'm here, ready when the group needs a leaderboard.";
  const trimmed = response?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.length > 180 ? `${trimmed.slice(0, 177).trimEnd()}...` : trimmed;
}

function gamesOnlyResponse() {
  return "I only focus on the games from here. Mention a fixture, prediction, or leaderboard.";
}

async function resolveScoreTarget(
  match: MatchRef,
  activeGroupMatches: ActiveGroupMatchRow[],
  txline: TxLineClient
): Promise<
  | { kind: "selected"; fixtureId: number; participant1: string; participant2: string; competition?: string | null; matchId?: string }
  | { kind: "ambiguous"; fixtures: MatchOption[] }
  | { kind: "none" }
> {
  const query = matchQueryFromRef(match);
  if (!query) {
    if (activeGroupMatches.length === 0) {
      return { kind: "none" };
    }
    if (activeGroupMatches.length > 1) {
      return { kind: "ambiguous", fixtures: activeGroupMatches.map((row) => row.match) };
    }
    const active = activeGroupMatches[0];
    return { kind: "selected", fixtureId: active.match.txlineFixtureId, participant1: active.match.participant1, participant2: active.match.participant2, competition: active.match.competition, matchId: active.match.id };
  }

  const activeMatchesForRef = activeGroupMatches.filter((row) => matchRefMatchesFixture(match, row.match));
  if (activeMatchesForRef.length === 1) {
    const active = activeMatchesForRef[0];
    return { kind: "selected", fixtureId: active.match.txlineFixtureId, participant1: active.match.participant1, participant2: active.match.participant2, competition: active.match.competition, matchId: active.match.id };
  }
  if (activeMatchesForRef.length > 1) {
    return { kind: "ambiguous", fixtures: activeMatchesForRef.map((row) => row.match) };
  }

  const fixtures = await txline.getFixtures();
  const selected = selectFixture(fixtures, match);
  if (!selected) {
    return fixtures.length > 1 ? { kind: "ambiguous", fixtures: fixtures.slice(0, 5).map((fixture) => ({
      participant1: fixture.participant1,
      participant2: fixture.participant2,
      competition: fixture.competition ?? null,
      startTime: fixture.startTime
    })) } : { kind: "none" };
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
  const [existing] = await db
    .select({ match: matches })
    .from(groupMatches)
    .innerJoin(matches, eq(groupMatches.matchId, matches.id))
    .where(and(eq(groupMatches.groupId, groupId), eq(groupMatches.matchId, matchId), eq(groupMatches.status, "active")))
    .limit(1);
  if (existing) {
    return existing.match;
  }
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
