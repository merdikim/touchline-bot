import { Bot, type Context } from "grammy";
import { eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { groupMatches, matches, matchStates, oddsSnapshots } from "../db/schema";
import type { WorkerEnv } from "../env";
import { IntentRouter } from "../ai/intent-router";
import { TxLineClient } from "../txline/client";
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

    const group = await groups.upsertTelegramGroup({ telegramGroupId: String(chat.id), title: "title" in chat ? chat.title : null });
    const user = message.from ? await users.upsertTelegramUser({
      telegramUserId: String(message.from.id),
      username: message.from.username,
      displayName: displayName(message.from)
    }) : null;
    const context = await groups.loadContext(group.id);

    const intent = await router.route({
      text: message.text,
      botMentioned,
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
        text: message.text,
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
      log("error", "telegram intent failed", { error: error instanceof Error ? error.message : String(error), intent: intent.intent });
      await ctx.reply("I hit a snag reading the match data. Try me again in a moment.");
    }
  });

  return bot;
}

function groupCommandToNaturalText(text: string, botUsername: string) {
  const escapedUsername = botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const command = text.match(new RegExp(`^\\/(demo|touchline|create|leaderboard|score|verify)(?:@${escapedUsername})?\\b\\s*(.*)$`, "i"));
  if (!command) {
    return null;
  }

  console.log(command)

  const [, name, rest = ""] = command;
  switch (name.toLowerCase()) {
    case "demo":
      return "run demo";
    case "create":
      return `create a leaderboard for ${rest}`.trim();
    case "leaderboard":
      return "who's winning?";
    case "score":
      return "what's the score?";
    case "verify":
      return "verify the score";
    default:
      return rest || "run demo";
  }
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
    const selection = await deps.matchesService.createGroupMatch(deps.groupId, deps.intent.params.matchQuery || deps.text);
    if (selection.kind === "none") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.noMatch());
      return;
    }
    if (selection.kind === "ambiguous") {
      await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.ambiguous(selection.fixtures.map((fixture) => ({
        participant1: fixture.participant1,
        participant2: fixture.participant2,
        startTime: formatKickoff(fixture.startTime)
      }))));
      return;
    }
    const text = deps.commentary.createdMatch({
      participant1: selection.match.participant1,
      participant2: selection.match.participant2,
      kickoff: formatKickoff(selection.match.startTime)
    });
    await replyAndRemember(ctx, deps.groups, deps.groupId, text);
    return;
  }

  if (deps.intent.intent === "run_demo") {
    const match = await createDemoMatch(deps.db, deps.groupId);
    const text = deps.commentary.createdMatch({ participant1: match.participant1, participant2: match.participant2, kickoff: formatKickoff(match.startTime) });
    await replyAndRemember(ctx, deps.groups, deps.groupId, `${text}\n\nDemo mode is ready, so judges can submit picks right now.`);
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
      rawPrediction: deps.intent.params.rawPrediction ?? deps.text
    });
    const text = result.ok
      ? deps.commentary.predictionLocked({ displayName: deps.userDisplayName, participant1: active.match.participant1, participant2: active.match.participant2, score: `${result.prediction.participant1Score}-${result.prediction.participant2Score}` })
      : result.reason;
    await replyAndRemember(ctx, deps.groups, deps.groupId, text);
    return;
  }

  if (deps.intent.intent === "get_match_status") {
    const score = await deps.txline.getScoreSnapshot(active.match.txlineFixtureId);
    await upsertScoreState(deps.db, active.match.id, score);
    await replyAndRemember(ctx, deps.groups, deps.groupId, deps.commentary.status({
      participant1: active.match.participant1,
      participant2: active.match.participant2,
      participant1Score: score.participant1Score,
      participant2Score: score.participant2Score,
      state: score.displayState ?? score.gameState,
      confirmed: score.confirmed
    }));
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

  if (deps.intent.intent === "get_available_matches") {
    const fixtures = await deps.txline.getFixtures();
    const text = fixtures.slice(0, 5).map((fixture, index) => `${index + 1}. ${fixture.participant1} vs ${fixture.participant2} (${formatKickoff(fixture.startTime)})`).join("\n") || "No fixtures returned by TxLINE right now.";
    await replyAndRemember(ctx, deps.groups, deps.groupId, text);
    return;
  }

  await replyAndRemember(ctx, deps.groups, deps.groupId, deps.intent.intent === "smalltalk" ? "I'm here. Give me a fixture and I'll run the leaderboard." : deps.intent.params.clarificationQuestion);
}

async function replyAndRemember(ctx: Context, groups: GroupService, groupId: string, text: string) {
  await ctx.reply(text);
  await groups.setLatestBotPrompt(groupId, text);
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
