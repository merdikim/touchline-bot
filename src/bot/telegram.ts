import { Bot, type Context } from "grammy";
import { and, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { groupMatches, matches, matchStates, oddsSnapshots } from "../db/schema";
import type { WorkerEnv } from "../env";
import { AiRateLimitError, IntentRouter } from "../ai/intent-router";
import { AiMessageFormatter } from "../ai/message-formatter";
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
import { ReminderService } from "../services/reminder-service";
import { displayName } from "./formatters";
import { mention, stripTelegramHtml, toTelegramHtml } from "./mentions";
import { formatKickoff } from "../utils/dates";
import { newId } from "../utils/ids";
import { log } from "../utils/logger";

type Db = ReturnType<typeof createDb>;
type ActiveGroupMatchRow = {
  groupMatch: typeof groupMatches.$inferSelect;
  match: typeof matches.$inferSelect;
};
type MatchOption = Pick<typeof matches.$inferSelect, "participant1" | "participant2" | "competition" | "startTime">;
type RememberedFixture = Pick<NormalizedFixture, "fixtureId" | "competitionId" | "competition" | "participant1" | "participant2" | "participant1IsHome" | "startTime"> & { raw?: unknown };
type PendingAction = {
  action: "set_match_alert";
  offsetMinutes?: number;
  remindInMinutes?: number;
};
type HandleIntentDeps = {
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
  reminders: ReminderService;
  repliedFixtures: RememberedFixture[];
  pendingAction: PendingAction | null;
  formatter: AiMessageFormatter;
};
type SendReply = (text: string, messageType?: string, payload?: Record<string, unknown>) => Promise<void>;

export function createTelegramBot(env: WorkerEnv, db: Db) {
  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);
  const txline = new TxLineClient(env);
  const groups = new GroupService(db);
  const users = new UserService(db);
  const matchesService = new MatchService(db, txline);
  const predictions = new PredictionService(db);
  const leaderboard = new LeaderboardService(db);
  const commentary = new CommentaryService(env.TELEGRAM_BOT_USERNAME);
  const verification = new VerificationService(db, txline);
  const reminders = new ReminderService(db);
  const router = new IntentRouter(env);
  const formatter = new AiMessageFormatter(env);

  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    if (chat.type === "private" || !joinedChat(update.old_chat_member.status, update.new_chat_member.status)) {
      return;
    }

    const group = await groups.upsertTelegramGroup({ telegramGroupId: String(chat.id), title: "title" in chat ? chat.title : null });
    await replyAndRemember(ctx, groups, group.id, formatter, commentary.groupIntro(), "group_intro", { kind: "group_intro", allowGreeting: true });
  });

  bot.on("message:text", async (ctx) => {
    const message = ctx.message;
    const chat = message.chat;

    if (chat.type === "private") {
      await reply(ctx, formatter, "Invite me into a group and mention me to get started!", { kind: "private_intro" });
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
    const repliedBotMessage = message.reply_to_message
      ? await groups.loadBotMessage({ groupId: group.id, telegramMessageId: String(message.reply_to_message.message_id) })
      : null;

    let intent: Awaited<ReturnType<IntentRouter["route"]>>;
    try {
      intent = await router.route({
        text: routedText,
        replyToBot,
        predictionsOpen: context.activeGroupMatches.some((row) => row.groupMatch.predictionsOpen === 1),
        latestBotPrompt: context.group?.latestBotPrompt,
        repliedBotMessageText: message.reply_to_message && "text" in message.reply_to_message ? message.reply_to_message.text : null,
        activeMatch: context.activeMatch ? { participant1: context.activeMatch.participant1, participant2: context.activeMatch.participant2 } : null,
        activeMatches: context.activeGroupMatches.map((row) => ({ participant1: row.match.participant1, participant2: row.match.participant2 }))
      });
    } catch (error) {
      if (error instanceof AiRateLimitError) {
        log("warn", "ai rate limited, skipping intent routing", { groupId: group.id, retryAfterSeconds: error.retryAfterSeconds });
        // formatting this would spend another call against the same exhausted limit
        await replyWithoutFormatting(ctx, busyResponse(error.retryAfterSeconds));
        return;
      }
      throw error;
    }

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
        verification,
        reminders,
        repliedFixtures: fixturesFromBotMessagePayload(repliedBotMessage?.payload),
        pendingAction: pendingActionFromBotMessagePayload(repliedBotMessage?.payload),
        formatter
      });
    } catch (error) {
      log("error", "telegram intent failed", { error: error instanceof Error ? error.message : "Unknown error", intent: intent.intent });
      await reply(ctx, formatter, "I hit a snag reading the match data. Try me again in a moment.", { kind: "error", userMessage: routedText });
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
  deps: HandleIntentDeps
) {
  const activeGroupMatches = deps.context.activeGroupMatches;
  const send = (text: string, messageType?: string, payload?: Record<string, unknown>) => replyAndRemember(
    ctx,
    deps.groups,
    deps.groupId,
    deps.formatter,
    text,
    messageType,
    { kind: messageType ?? deps.intent.intent, userMessage: deps.text },
    payload
  );

  if (deps.pendingAction?.action === "set_match_alert") {
    const handled = await handleSetMatchAlert(ctx, deps, send, deps.pendingAction);
    if (handled) {
      return;
    }
  }

  if (deps.intent.intent === "create_group_match") {
    const repliedFixture = selectRepliedFixture(deps.repliedFixtures, deps.text);
    if (repliedFixture.kind === "ambiguous") {
      await send("I see a few fixtures in that message. Reply with the number too, like: alert me 1 hour before 2");
      return;
    }
    if (repliedFixture.kind === "selected") {
      const selection = await deps.matchesService.createGroupMatchFromFixture(deps.groupId, normalizeRememberedFixture(repliedFixture.fixture));
      if (selection.kind === "selected") {
        const text = deps.commentary.createdMatch({
          participant1: selection.match.participant1,
          participant2: selection.match.participant2,
          competition: selection.match.competition,
          kickoff: formatKickoff(selection.match.startTime)
        });
        await send(text);
        return;
      }
    }

    const selection = await deps.matchesService.createGroupMatch(deps.groupId, matchQueryFromRef(deps.intent.match) ?? deps.text);
    if (selection.kind === "none") {
      await send(deps.commentary.noMatch());
      return;
    }
    if (selection.kind === "ambiguous") {
      await send(deps.commentary.ambiguous(selection.fixtures.map((fixture) => ({
        participant1: fixture.participant1,
        participant2: fixture.participant2,
        competition: fixture.competition,
        startTime: formatKickoff(fixture.startTime)
      }))), "fixtures_list", { fixtures: rememberFixtures(selection.fixtures) });
      return;
    }
    const text = deps.commentary.createdMatch({
      participant1: selection.match.participant1,
      participant2: selection.match.participant2,
      competition: selection.match.competition,
      kickoff: formatKickoff(selection.match.startTime)
    });
    await send(text);
    return;
  }

  if (deps.intent.intent === "run_demo") {
    const match = await createDemoMatch(deps.db, deps.groupId);
    const text = deps.commentary.createdMatch({ participant1: match.participant1, participant2: match.participant2, competition: match.competition, kickoff: formatKickoff(match.startTime) });
    await send(`${text}\n\nDemo mode is ready, so judges can submit picks right now.`);
    return;
  }

  if (deps.intent.intent === "get_available_matches") {
    const fixtures = deps.repliedFixtures.length > 0
      ? deps.repliedFixtures.map(normalizeRememberedFixture)
      : await deps.txline.getFixtures();
    const filteredFixtures = filterAvailableFixtures(fixtures, {
      teamQuery: deps.intent.teamQuery,
      dateQuery: deps.intent.dateQuery,
      userText: deps.text,
      match: deps.intent.match
    });
    const text = fixtureListText(filteredFixtures, noAvailableFixturesMessage(deps.intent.dateQuery ?? deps.text));
    await send(text, "fixtures_list", { fixtures: rememberFixtures(filteredFixtures.slice(0, 20)) });
    return;
  }

  if (deps.intent.intent === "set_match_alert") {
    await handleSetMatchAlert(ctx, deps, send);
    return;
  }

  if (deps.intent.intent === "get_match_status") {
    if (isFixtureScheduleQuestion(deps.text) && !isLiveStatusQuestion(deps.text)) {
      const fixtures = deps.repliedFixtures.length > 0
        ? deps.repliedFixtures.map(normalizeRememberedFixture)
        : await deps.txline.getFixtures();
      const filteredFixtures = filterAvailableFixtures(fixtures, {
        teamQuery: deps.intent.teamQuery,
        dateQuery: deps.intent.dateQuery,
        userText: deps.text,
        match: deps.intent.match
      });
      const text = fixtureListText(filteredFixtures, noAvailableFixturesMessage(deps.intent.dateQuery ?? deps.text));
      await send(text, "fixtures_list", { fixtures: rememberFixtures(filteredFixtures.slice(0, 20)) });
      return;
    }

    const target = await resolveScoreTarget(deps.intent.match, activeGroupMatches, deps.txline);
    if (target.kind === "none") {
      await send(deps.intent.match.team1 || deps.intent.match.team2 ? deps.commentary.noMatch() : `Mention me with a fixture first, like: ${deps.commentary.mentionExample("what's the score for Brazil vs France")}`);
      return;
    }
    if (target.kind === "ambiguous") {
      await send(deps.commentary.ambiguous(target.fixtures.map((fixture) => ({
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
    await send(deps.commentary.status({
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

  if (deps.intent.intent === "get_match_info") {
    const target = await resolveScoreTarget(deps.intent.match, activeGroupMatches, deps.txline);
    if (target.kind === "none") {
      await send(deps.intent.match.team1 || deps.intent.match.team2 ? deps.commentary.noMatch() : `Mention me with a fixture first, like: ${deps.commentary.mentionExample("tell me about Brazil vs France")}`);
      return;
    }
    if (target.kind === "ambiguous") {
      await send(deps.commentary.ambiguous(target.fixtures.map((fixture) => ({
        participant1: fixture.participant1,
        participant2: fixture.participant2,
        competition: fixture.competition,
        startTime: formatKickoff(fixture.startTime)
      }))));
      return;
    }

    const [score, odds] = await Promise.all([
      deps.txline.getScoreSnapshot(target.fixtureId).catch(() => null),
      deps.txline.getOddsSnapshot(target.fixtureId, undefined, target.participant1, target.participant2).catch(() => null)
    ]);
    if (target.matchId && score) {
      await upsertScoreState(deps.db, target.matchId, score);
    }
    if (target.matchId && odds) {
      await deps.db.insert(oddsSnapshots).values({
        id: newId("odds"),
        matchId: target.matchId,
        txlineTs: Date.now(),
        summary: JSON.stringify(odds),
        rawOddsSnapshot: JSON.stringify(odds.raw)
      });
    }

    await send(deps.commentary.matchInfo({
      participant1: target.participant1,
      participant2: target.participant2,
      competition: target.competition,
      kickoff: formatKickoff(target.startTime),
      score: score ? {
        p1: score.participant1Score,
        p2: score.participant2Score,
        state: score.displayState ?? score.gameState,
        confirmed: score.confirmed,
        started: isScoreStarted(score, target.startTime),
        final: isScoreFinal(score)
      } : null,
      odds
    }));
    return;
  }

  if (deps.intent.intent === "unclear") {
    await send(deps.intent.clarificationQuestion ?? "Do you want a demo, a leaderboard, a prediction, or the score?", "unclear");
    return;
  }

  if (deps.intent.intent === "smalltalk") {
    const smalltalkCount = await deps.groups.countBotMessages({ groupId: deps.groupId, messageType: "smalltalk" });
    if (smalltalkCount >= 200) {
      await send(gamesOnlyResponse(), "smalltalk_limit");
      return;
    }
    await send(conciseSmalltalkResponse(deps.intent.smalltalkResponse), "smalltalk");
    return;
  }

  if (deps.intent.intent === "submit_prediction") {
    if (!deps.userId) {
      await reply(ctx, deps.formatter, "I need a Telegram user to lock that prediction.", { kind: "missing_user", userMessage: deps.text });
      return;
    }
    const target = resolveActiveGroupMatchTarget(deps.intent.match, activeGroupMatches);
    if (target.kind === "none") {
      await send(`Mention me with a fixture first, like: ${deps.commentary.mentionExample("create a leaderboard for Brazil vs France")}`);
      return;
    }
    if (target.kind === "ambiguous") {
      await send(activeMatchClarification(target.matches, deps.commentary));
      return;
    }
    const result = await deps.predictions.submit({
      groupMatchId: target.groupMatch.id,
      userId: deps.userId,
      match: target.match,
      rawPrediction: deps.intent.prediction?.raw || deps.text
    });
    const text = result.ok
      ? deps.commentary.predictionLocked({ displayName: deps.userDisplayName, platformUserId: ctx.message?.from ? String(ctx.message.from.id) : null, username: ctx.message?.from?.username, participant1: target.match.participant1, participant2: target.match.participant2, score: `${result.prediction.participant1Score}-${result.prediction.participant2Score}` })
      : result.reason;
    await send(text);
    return;
  }

  if (deps.intent.intent === "get_leaderboard") {
    const target = resolveActiveGroupMatchTarget(deps.intent.match, activeGroupMatches);
    if (target.kind === "none") {
      await send(`Mention me with a fixture first, like: ${deps.commentary.mentionExample("create a leaderboard for Brazil vs France")}`);
      return;
    }
    if (target.kind === "ambiguous") {
      await send(activeMatchClarification(target.matches, deps.commentary));
      return;
    }
    const entries = await deps.leaderboard.calculate(target.groupMatch.id, target.match.id, target.groupMatch.baselineOddsSummary);
    await send(deps.commentary.leaderboard(entries));
    return;
  }

  if (deps.intent.intent === "get_odds_commentary") {
    const target = await resolveScoreTarget(deps.intent.match, activeGroupMatches, deps.txline);
    if (target.kind === "none") {
      await send(deps.intent.match.team1 || deps.intent.match.team2 ? deps.commentary.noMatch() : `Mention me with a fixture first, like: ${deps.commentary.mentionExample("odds for Brazil vs France")}`);
      return;
    }
    if (target.kind === "ambiguous") {
      await send(deps.commentary.ambiguous(target.fixtures.map((fixture) => ({
        participant1: fixture.participant1,
        participant2: fixture.participant2,
        competition: fixture.competition,
        startTime: formatKickoff(fixture.startTime)
      }))));
      return;
    }
    const odds = await deps.txline.getOddsSnapshot(target.fixtureId, undefined, target.participant1, target.participant2);
    if (target.matchId) {
      await deps.db.insert(oddsSnapshots).values({
        id: newId("odds"),
        matchId: target.matchId,
        txlineTs: Date.now(),
        summary: JSON.stringify(odds),
        rawOddsSnapshot: JSON.stringify(odds.raw)
      });
    }
    await send(deps.commentary.odds({
      participant1: target.participant1,
      participant2: target.participant2,
      competition: target.competition,
      summary: odds
    }));
    return;
  }

  if (deps.intent.intent === "get_verification") {
    const target = resolveActiveGroupMatchTarget(deps.intent.match, activeGroupMatches);
    if (target.kind === "none") {
      await send(`Mention me with a fixture first, like: ${deps.commentary.mentionExample("create a leaderboard for Brazil vs France")}`);
      return;
    }
    if (target.kind === "ambiguous") {
      await send(activeMatchClarification(target.matches, deps.commentary));
      return;
    }
    await send(await deps.verification.summarize(target.match.id, target.match.txlineFixtureId));
    return;
  }

  await send(`Mention me with a fixture first, like: ${deps.commentary.mentionExample("create a leaderboard for Brazil vs France")}`);
}

async function handleSetMatchAlert(ctx: Context, deps: HandleIntentDeps, send: SendReply, pendingAction?: PendingAction | null) {
  const timing = parseReminderTiming(deps.text);
  const offsetMinutes = timing.kind === "before" ? timing.minutes : pendingAction?.offsetMinutes ?? 60;
  const remindInMinutes = timing.kind === "in" ? timing.minutes : pendingAction?.remindInMinutes;
  const nextPendingAction = { action: "set_match_alert" as const, offsetMinutes, remindInMinutes };
  const repliedFixture = selectRepliedFixture(deps.repliedFixtures, deps.text);
  if (repliedFixture.kind === "ambiguous") {
    await send(
      "I see a few fixtures in that message. Reply with the number too, like: alert me 1 hour before 2",
      "alert_clarification",
      { fixtures: deps.repliedFixtures, pendingAction: nextPendingAction }
    );
    return true;
  }

  const filteredFixtures = repliedFixture.kind === "selected"
    ? [normalizeRememberedFixture(repliedFixture.fixture)]
    : filterAvailableFixtures(await deps.txline.getFixtures(), {
      teamQuery: deps.intent.teamQuery ?? freeformFixtureQuery(deps.text),
      dateQuery: deps.intent.dateQuery,
      userText: deps.text,
      match: deps.intent.match
    });

  if (filteredFixtures.length === 0) {
    await send(
      "I couldn'''t find that upcoming fixture. Reply with the teams, tournament, or day and I'll keep the reminder request open.",
      "alert_clarification",
      { pendingAction: nextPendingAction }
    );
    return true;
  }

  if (filteredFixtures.length > 1) {
    const fixtures = filteredFixtures.slice(0, 5);
    await send(
      `I found a few possible fixtures. Which one should I remind you about?\n\n${fixtureListText(fixtures, "")}`,
      "fixtures_list",
      { fixtures: rememberFixtures(fixtures), pendingAction: nextPendingAction }
    );
    return true;
  }

  const reminderOffsetMinutes = remindInMinutes
    ? offsetMinutesFromRelativeReminder(filteredFixtures[0].startTime, remindInMinutes)
    : offsetMinutes;
  if (reminderOffsetMinutes <= 0) {
    await send("That reminder would land after kickoff for this fixture, so I can't use it as a pre-game alert. Try a shorter time from now or pick another match.");
    return true;
  }

  const reminder = await deps.reminders.create({
    groupId: deps.groupId,
    userId: deps.userId,
    requesterUsername: ctx.message?.from?.username,
    requesterDisplayName: deps.userDisplayName,
    fixture: filteredFixtures[0],
    offsetMinutes: reminderOffsetMinutes
  });

  if (reminder.kind === "too_late") {
    await send(
      "That reminder time has already passed for this fixture. Reply with a shorter alert window or another match.",
      "alert_clarification",
      { fixtures: rememberFixtures(filteredFixtures), pendingAction: { action: "set_match_alert" } }
    );
    return true;
  }
  if (reminder.kind === "invalid_kickoff") {
    await send("I found the fixture, but I could not get a usable kickoff time for it.");
    return true;
  }

  const timingText = remindInMinutes
    ? `in about ${formatReminderOffset(remindInMinutes)}`
    : `${formatReminderOffset(offsetMinutes)} before kickoff`;
  await send(`Done. I will remind you ${timingText} for ${filteredFixtures[0].participant1} vs ${filteredFixtures[0].participant2}.`);
  return true;
}

async function replyWithoutFormatting(ctx: Context, text: string) {
  return ctx.reply(toTelegramHtml(withRequesterMention(ctx, text)), { parse_mode: "HTML" });
}

async function reply(ctx: Context, formatter: AiMessageFormatter, text: string, context?: Parameters<AiMessageFormatter["format"]>[1]) {
  const formatted = await formatter.format(text, { ...context, parseMode: "HTML" });
  return ctx.reply(toTelegramHtml(withRequesterMention(ctx, formatted)), { parse_mode: "HTML" });
}

async function replyAndRemember(ctx: Context, groups: GroupService, groupId: string, formatter: AiMessageFormatter, text: string, messageType?: string, context?: Parameters<AiMessageFormatter["format"]>[1], payload?: Record<string, unknown>) {
  const formatted = await formatter.format(text, { ...(context ?? { kind: messageType }), parseMode: "HTML" });
  const textWithMention = withRequesterMention(ctx, formatted);
  const message = await ctx.reply(toTelegramHtml(textWithMention), { parse_mode: "HTML" });
  const plainText = stripTelegramHtml(textWithMention);
  await groups.setLatestBotPrompt(groupId, plainText);
  if (messageType) {
    await groups.rememberBotMessage({
      groupId,
      telegramMessageId: String(message.message_id),
      messageType,
      payload: { ...payload, text: plainText, draft: stripTelegramHtml(text) }
    });
  }
}

function withRequesterMention(ctx: Context, text: string) {
  const requester = ctx.message?.from;
  const chatType = ctx.message?.chat.type;
  if (!requester || chatType === "private") {
    return text;
  }
  const requesterMention = mention({ platformUserId: String(requester.id), username: requester.username, displayName: displayName(requester) });
  if (text.startsWith(requesterMention)) {
    return text;
  }
  return `${requesterMention} ${stripAudienceGreeting(text)}`;
}

function stripAudienceGreeting(text: string) {
  return text
    .replace(/^\s*(hey|hi|hello|yo)\s+(team|folks|everyone|all|mate|there)[,!:\-\s]+/i, "")
    .replace(/^\s*(hey|hi|hello|yo)[,!:\-\s]+/i, "")
    .replace(/^\s*(team|folks|everyone)[,!:\-\s]+/i, "")
    .trimStart();
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

function activeMatchClarification(matches: MatchOption[], commentary: CommentaryService) {
  const options = matches.map((match, index) => {
    const details = [match.competition, formatKickoff(match.startTime)].filter(Boolean).join(", ");
    return `${index + 1}. ${match.participant1} vs ${match.participant2}${details ? ` (${details})` : ""}`;
  }).join("\n");
  return `Which leaderboard do you mean?\n\n${options}\n\nMention me with the teams, like: ${commentary.mentionExample("leaderboard for Brazil vs France")}`;
}

function rememberFixtures(fixtures: NormalizedFixture[]): RememberedFixture[] {
  return fixtures.map((fixture) => ({
    fixtureId: fixture.fixtureId,
    competitionId: fixture.competitionId,
    competition: fixture.competition,
    participant1: fixture.participant1,
    participant2: fixture.participant2,
    participant1IsHome: fixture.participant1IsHome,
    startTime: fixture.startTime,
    raw: fixture.raw
  }));
}

function fixturesFromBotMessagePayload(payload?: string | null): RememberedFixture[] {
  if (!payload) {
    return [];
  }
  try {
    const parsed = JSON.parse(payload) as { fixtures?: unknown };
    if (!Array.isArray(parsed.fixtures)) {
      return [];
    }
    return parsed.fixtures.filter(isRememberedFixture);
  } catch {
    return [];
  }
}

function pendingActionFromBotMessagePayload(payload?: string | null): PendingAction | null {
  if (!payload) {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as { pendingAction?: unknown };
    if (!parsed.pendingAction || typeof parsed.pendingAction !== "object") {
      return null;
    }
    const pending = parsed.pendingAction as Partial<PendingAction>;
    if (pending.action !== "set_match_alert") {
      return null;
    }
    return {
      action: "set_match_alert",
      offsetMinutes: typeof pending.offsetMinutes === "number" ? pending.offsetMinutes : undefined,
      remindInMinutes: typeof pending.remindInMinutes === "number" ? pending.remindInMinutes : undefined
    };
  } catch {
    return null;
  }
}

function isRememberedFixture(value: unknown): value is RememberedFixture {
  if (!value || typeof value !== "object") {
    return false;
  }
  const fixture = value as Partial<RememberedFixture>;
  return typeof fixture.fixtureId === "number"
    && typeof fixture.participant1 === "string"
    && typeof fixture.participant2 === "string"
    && typeof fixture.participant1IsHome === "boolean"
    && typeof fixture.startTime === "string";
}

function normalizeRememberedFixture(fixture: RememberedFixture): NormalizedFixture {
  return {
    fixtureId: fixture.fixtureId,
    competitionId: fixture.competitionId,
    competition: fixture.competition,
    participant1: fixture.participant1,
    participant2: fixture.participant2,
    participant1IsHome: fixture.participant1IsHome,
    startTime: fixture.startTime,
    raw: fixture.raw ?? fixture
  };
}

function selectRepliedFixture(fixtures: RememberedFixture[], text: string):
  | { kind: "none" }
  | { kind: "selected"; fixture: RememberedFixture }
  | { kind: "ambiguous" } {
  if (fixtures.length === 0) {
    return { kind: "none" };
  }
  if (fixtures.length === 1) {
    return { kind: "selected", fixture: fixtures[0] };
  }

  const index = requestedFixtureIndex(text);
  if (index !== null && fixtures[index]) {
    return { kind: "selected", fixture: fixtures[index] };
  }
  return { kind: "ambiguous" };
}

function requestedFixtureIndex(text: string) {
  const normalized = text.toLowerCase();
  const digit = normalized.match(/\b([1-9]|1\d|20)\b/);
  if (digit) {
    return Number(digit[1]) - 1;
  }
  const ordinals: Record<string, number> = {
    first: 0,
    second: 1,
    third: 2,
    fourth: 3,
    fifth: 4,
    sixth: 5,
    seventh: 6,
    eighth: 7,
    ninth: 8,
    tenth: 9
  };
  const word = Object.keys(ordinals).find((ordinal) => new RegExp(`\\b${ordinal}\\b`).test(normalized));
  return word ? ordinals[word] : null;
}

function filterAvailableFixtures(
  fixtures: NormalizedFixture[],
  input: { teamQuery?: string | null; dateQuery?: string | null; userText: string; match?: MatchRef }
) {
  const dateRange = fixtureDateRange(input.dateQuery ?? input.userText);
  const teamQuery = input.teamQuery?.trim();
  const textQuery = teamQuery && !queryDuplicatesMatchRef(teamQuery, input.match) ? teamQuery : null;
  return fixtures.filter((fixture) => {
    if (dateRange && !fixtureStartsInRange(fixture.startTime, dateRange)) {
      return false;
    }
    if (input.match && !matchRefMatchesFixture(input.match, fixture)) {
      return false;
    }
    if (textQuery && !fixtureMatchesText(fixture, textQuery)) {
      return false;
    }
    return true;
  });
}

function queryDuplicatesMatchRef(query: string, match?: MatchRef) {
  const teams = [match?.team1, match?.team2].filter((team): team is string => Boolean(team)).map(normalizeTeamName);
  if (teams.length === 0) {
    return false;
  }
  const normalized = normalizeTeamName(query);
  return teams.length === 1
    ? normalized === teams[0]
    : normalized === `${teams[0]} ${teams[1]}` || normalized === `${teams[1]} ${teams[0]}`;
}

function fixtureDateRange(query: string) {
  const normalized = query.toLowerCase();
  const now = new Date();
  if (/\b(today|tonight)\b/.test(normalized)) {
    return utcDayRange(now);
  }
  if (/\btomorrow\b/.test(normalized)) {
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return utcDayRange(tomorrow);
  }
  if (/\bnext\s+week\b/.test(normalized)) {
    return utcNextWeekRange(now);
  }
  if (/\b(this\s+week|week)\b/.test(normalized)) {
    return utcThisWeekRange(now);
  }
  if (/\bweekend\b/.test(normalized)) {
    return utcWeekendRange(now);
  }
  if (/\b(this\s+month|month)\b/.test(normalized)) {
    return utcThisMonthRange(now);
  }
  const weekday = weekdayFromQuery(normalized);
  if (weekday !== null) {
    return utcWeekdayRange(now, weekday, /\bnext\s+(sun|mon|tue|wed|thu|fri|sat)/.test(normalized));
  }
  return null;
}

function utcDayRange(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function utcThisWeekRange(date: Date) {
  const todayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { start: todayStart, end: todayStart + 7 * 24 * 60 * 60 * 1000 };
}

function utcNextWeekRange(date: Date) {
  const todayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const nextWeekStart = todayStart + 7 * 24 * 60 * 60 * 1000;
  return { start: nextWeekStart, end: nextWeekStart + 7 * 24 * 60 * 60 * 1000 };
}

function utcWeekendRange(date: Date) {
  const todayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const daysUntilSaturday = (6 - date.getUTCDay() + 7) % 7;
  const start = todayStart + daysUntilSaturday * 24 * 60 * 60 * 1000;
  return { start, end: start + 2 * 24 * 60 * 60 * 1000 };
}

function utcThisMonthRange(date: Date) {
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  return { start, end };
}

function utcWeekdayRange(date: Date, weekday: number, forceNext = false) {
  const todayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  let daysUntil = (weekday - date.getUTCDay() + 7) % 7;
  if (forceNext && daysUntil === 0) {
    daysUntil = 7;
  }
  const start = todayStart + daysUntil * 24 * 60 * 60 * 1000;
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function weekdayFromQuery(query: string) {
  const weekdays = [
    ["sunday", "sun"],
    ["monday", "mon"],
    ["tuesday", "tue", "tues"],
    ["wednesday", "wed"],
    ["thursday", "thu", "thur", "thurs"],
    ["friday", "fri"],
    ["saturday", "sat"]
  ];
  const match = weekdays.find((names) => names.some((name) => new RegExp(`\\b${name}\\b`).test(query)));
  return match ? weekdays.indexOf(match) : null;
}

function fixtureStartsInRange(startTime: string, range: { start: number; end: number }) {
  const kickoff = new Date(startTime).getTime();
  return Number.isFinite(kickoff) && kickoff >= range.start && kickoff < range.end;
}

function fixtureMatchesText(fixture: NormalizedFixture, text: string) {
  const needle = normalizeTeamName(text);
  if (!needle) {
    return true;
  }
  const haystack = [fixture.participant1, fixture.participant2, fixture.competition ?? ""].map(normalizeTeamName).join(" ");
  return haystack.includes(needle) || needle.split(" ").some((part) => part.length > 2 && haystack.includes(part));
}

function freeformFixtureQuery(text: string) {
  const normalized = normalizeTeamName(text);
  if (!normalized || /^\d+$/.test(normalized) || fixtureDateRange(text)) {
    return null;
  }
  const genericWords = new Set(["this", "that", "game", "match", "fixture", "one", "before", "remind", "alert", "me"]);
  const words = normalized.split(" ").filter((word) => !genericWords.has(word));
  return words.length > 0 ? words.join(" ") : null;
}

function fixtureListText(fixtures: NormalizedFixture[], fallback: string) {
  return fixtures.slice(0, 20).map((fixture, index) => {
    const details = [fixture.competition, formatKickoff(fixture.startTime)].filter(Boolean).join(", ");
    return `${index + 1}. ${fixture.participant1} vs ${fixture.participant2}${details ? ` (${details})` : ""}`;
  }).join("\n") || fallback;
}

function isFixtureScheduleQuestion(text: string) {
  return /\b(when|what\s+time|kick\s*off|kickoff|fixture|fixtures|schedule|games?|matches?|play(?:ing)?)\b/i.test(text);
}

function isLiveStatusQuestion(text: string) {
  return /\b(e?score|live|now|current(?:ly)?|status|result|winning|who'?s\s+up|what'?s\s+happening|full\s*time|half\s*time|ft|ht)\b/i.test(text);
}

function isScoreFinal(score: { gameState?: string; displayState?: string }) {
  const state = `${score.gameState ?? ""} ${score.displayState ?? ""}`.toLowerCase();
  return /\b(full|final|ft|full[_ -]?time|ended|complete|completed)\b/.test(state);
}

function isScoreStarted(score: { gameState?: string; displayState?: string }, startTime: string) {
  if (isScoreFinal(score)) {
    return true;
  }
  const state = `${score.gameState ?? ""} ${score.displayState ?? ""}`.toLowerCase();
  if (/\b(live|in[_ -]?play|started|kick[_ -]?off|first half|second half|1h|2h|half[_ -]?time|ht)\b/.test(state)) {
    return true;
  }
  const kickoff = new Date(startTime).getTime();
  return Number.isFinite(kickoff) && Date.now() >= kickoff;
}

function parseReminderTiming(text: string): { kind: "before" | "in"; minutes: number } | { kind: "default" } {
  const normalized = text.toLowerCase();
  const inMatch = normalized.match(/\bin\s+(.+?)(?:\s+(?:about|for|before)\b|$)/);
  if (inMatch) {
    const minutes = parseReminderDurationMinutes(inMatch[1]);
    if (minutes) {
      return { kind: "in", minutes };
    }
  }
  const beforeMatch = normalized.match(/(.+?)\s+before\b/);
  if (beforeMatch) {
    const minutes = parseReminderDurationMinutes(beforeMatch[1]);
    if (minutes) {
      return { kind: "before", minutes };
    }
  }
  const minutes = parseReminderDurationMinutes(normalized);
  return minutes ? { kind: "before", minutes } : { kind: "default" };
}

function parseReminderDurationMinutes(text: string) {
  if (/\bhalf\s+(an?\s+)?hour\b/.test(text)) {
    return 30;
  }
  const hourMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|h)\b/);
  if (hourMatch) {
    return Math.round(Number(hourMatch[1]) * 60);
  }
  const minuteMatch = text.match(/\b(\d+)\s*(minutes?|mins?|m)\b/);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }
  if (/\ban?\s+hour\b/.test(text)) {
    return 60;
  }
  return null;
}

function offsetMinutesFromRelativeReminder(startTime: string, remindInMinutes: number) {
  const kickoff = new Date(startTime).getTime();
  if (!Number.isFinite(kickoff)) {
    return 0;
  }
  return Math.ceil((kickoff - (Date.now() + remindInMinutes * 60 * 1000)) / 60_000);
}

function formatReminderOffset(minutes: number) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function noAvailableFixturesMessage(query: string) {
  const normalized = query.toLowerCase();
  if (/\b(today|tonight)\b/.test(normalized)) {
    return "No fixtures found for today.";
  }
  if (/\bnext\s+week\b/.test(normalized)) {
    return "No fixtures found for next week.";
  }
  if (/\b(this\s+week|week)\b/.test(normalized)) {
    return "No fixtures found for this week.";
  }
  if (/\bweekend\b/.test(normalized)) {
    return "No fixtures found for this weekend.";
  }
  if (/\b(this\s+month|month)\b/.test(normalized)) {
    return "No fixtures found for this month.";
  }
  return "No fixtures found right now.";
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

function busyResponse(retryAfterSeconds?: number) {
  const wait = retryAfterSeconds && retryAfterSeconds > 1
    ? ` Give me about ${Math.ceil(retryAfterSeconds)} seconds.`
    : " Give me a second.";
  return `I'm catching up on messages right now.${wait} Send that again and I'll pick it up.`;
}

async function resolveScoreTarget(
  match: MatchRef,
  activeGroupMatches: ActiveGroupMatchRow[],
  txline: TxLineClient
): Promise<
  | { kind: "selected"; fixtureId: number; participant1: string; participant2: string; competition?: string | null; startTime: string; matchId?: string }
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
    return { kind: "selected", fixtureId: active.match.txlineFixtureId, participant1: active.match.participant1, participant2: active.match.participant2, competition: active.match.competition, startTime: active.match.startTime, matchId: active.match.id };
  }

  const activeMatchesForRef = activeGroupMatches.filter((row) => matchRefMatchesFixture(match, row.match));
  if (activeMatchesForRef.length === 1) {
    const active = activeMatchesForRef[0];
    return { kind: "selected", fixtureId: active.match.txlineFixtureId, participant1: active.match.participant1, participant2: active.match.participant2, competition: active.match.competition, startTime: active.match.startTime, matchId: active.match.id };
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

  return { kind: "selected", fixtureId: selected.fixtureId, participant1: selected.participant1, participant2: selected.participant2, competition: selected.competition, startTime: selected.startTime };
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
  const kickoff = new Date(Date.now() + 60 * 1000).toISOString();
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
