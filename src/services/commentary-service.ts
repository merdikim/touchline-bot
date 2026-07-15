import type { LeaderboardEntry } from "./leaderboard-service";
import type { OddsMarket1x2, OddsSummary } from "../txline/types";
import { mention } from "../bot/mentions";

function pct(value: number) {
  return `~${Math.round(value)}%`;
}

export class CommentaryService {
  constructor(private readonly botUsername: string) {}

  mentionExample(example: string) {
    return `@${this.botUsername} ${example}`;
  }

  groupIntro() {
    return [
      "Yo, thanks for adding me.",
      "",
      "I am here for match days: set up prediction leaderboards, keep score with live updates, and give bragging rights when someone nails it.",
      "",
      "Scores and odds are verified by TxLINE (by TxODDS).",
      "",
      `Just mention me with a game when you are ready, like: ${this.mentionExample("Brazil vs France")}`
    ].join("\n");
  }

  createdMatch(input: { participant1: string; participant2: string; competition?: string | null; kickoff: string }) {
    const competition = input.competition ? `\n${input.competition}` : "";
    return `I'm in. ${input.participant1} vs ${input.participant2}${competition}\nKicks off ${input.kickoff}.\n\nDrop your predictions before kickoff.\nExample: ${input.participant1} 2-1`;
  }

  ambiguous(fixtures: Array<{ participant1: string; participant2: string; competition?: string | null; startTime: string }>) {
    const options = fixtures.map((fixture, index) => {
      const details = [fixture.competition, fixture.startTime].filter(Boolean).join(", ");
      return `${index + 1}. ${fixture.participant1} vs ${fixture.participant2}${details ? ` (${details})` : ""}`;
    }).join("\n");
    return `I found a few possible matches:\n\n${options}\n\nMention me with a clearer team or competition name.`;
  }

  noMatch() {
    return "I couldn't find that fixture yet. Try the team names or ask me for available matches.";
  }

  predictionLocked(input: { displayName: string; platformUserId?: string | null; username?: string | null; participant1: string; participant2: string; score: string }) {
    return `Locked in: ${mention(input)} has ${input.participant1} ${input.score} ${input.participant2}.`;
  }

  leaderboard(entries: LeaderboardEntry[]) {
    if (entries.length === 0) {
      return "No predictions locked yet. First brave pick gets the early spotlight.";
    }
    return entries.map((entry, index) => `${index + 1}. ${mention(entry)} - ${entry.points} pts (${entry.prediction})`).join("\n");
  }

  status(input: { participant1: string; participant2: string; competition?: string | null; participant1Score: number; participant2Score: number; state?: string | null; confirmed?: boolean | null }) {
    return `${input.participant1} ${input.participant1Score}-${input.participant2Score} ${input.participant2}${input.competition ? `\n${input.competition}` : ""}${input.state ? `\n${input.state}` : ""}\n\n${input.confirmed ? "Confirmed." : "Live, not confirmed yet."}`;
  }

  odds(input: { participant1: string; participant2: string; competition?: string | null; summary: OddsSummary }) {
    const header = `${input.participant1} vs ${input.participant2}${input.competition ? ` - ${input.competition}` : ""}`;
    const market = input.summary.market;
    if (!market) {
      const parts = [];
      if (input.summary.favorite) {
        parts.push(`${input.summary.favorite} look like the market favorite right now.`);
      }
      return `${header}\n${parts.join(" ") || "No clear market read from the latest odds snapshot."}\n\nNo advice here, just match context.`;
    }

    const favIsP1 = market.prob1 >= market.prob2;
    const favorite = favIsP1 ? input.participant1 : input.participant2;
    const underdog = favIsP1 ? input.participant2 : input.participant1;
    const favProb = favIsP1 ? market.prob1 : market.prob2;
    const undProb = favIsP1 ? market.prob2 : market.prob1;
    const read = Math.abs(market.prob1 - market.prob2) < 4
      ? `Too close to call: ${input.participant1} ${pct(market.prob1)}, ${input.participant2} ${pct(market.prob2)}, draw ${pct(market.probDraw)}.`
      : `${favorite} favorites (${pct(favProb)}). ${underdog} ${pct(undProb)}, draw ${pct(market.probDraw)}.`;
    return `${header}\n${read}\n\nNo advice here, just match context.`;
  }

  matchInfo(input: {
    participant1: string;
    participant2: string;
    competition?: string | null;
    kickoff: string;
    score?: { p1: number; p2: number; state?: string | null; confirmed?: boolean | null; started: boolean; final: boolean } | null;
    odds?: OddsSummary | null;
  }) {
    const lines = [`${input.participant1} vs ${input.participant2}${input.competition ? ` - ${input.competition}` : ""}`];

    if (input.score?.final) {
      lines.push(`Full-time: ${input.participant1} ${input.score.p1}-${input.score.p2} ${input.participant2}.`);
    } else if (input.score?.started) {
      lines.push(`Live: ${input.participant1} ${input.score.p1}-${input.score.p2} ${input.participant2}${input.score.state ? ` (${input.score.state})` : ""}.${input.score.confirmed ? "" : " Not confirmed yet."}`);
    } else {
      lines.push(`Kicks off ${input.kickoff}.`);
    }

    const market = input.odds?.market;
    if (market) {
      const favIsP1 = market.prob1 >= market.prob2;
      const favorite = favIsP1 ? input.participant1 : input.participant2;
      const favProb = favIsP1 ? market.prob1 : market.prob2;
      lines.push(Math.abs(market.prob1 - market.prob2) < 4
        ? `Market read: too close to call (${input.participant1} ${pct(market.prob1)}, ${input.participant2} ${pct(market.prob2)}).`
        : `Market read: ${favorite} favorites (${pct(favProb)}).`);
    }

    lines.push("Scores and odds verified by TxLINE.");
    return lines.join("\n");
  }

  oddsMovement(input: {
    participant1: string;
    participant2: string;
    competition?: string | null;
    previous: OddsMarket1x2;
    next: OddsMarket1x2;
  }) {
    const header = `Market update: ${input.participant1} vs ${input.participant2}`;
    const nextFavIsP1 = input.next.prob1 >= input.next.prob2;
    const prevFavIsP1 = input.previous.prob1 >= input.previous.prob2;
    const nextFav = nextFavIsP1 ? input.participant1 : input.participant2;
    const nextUnderdog = nextFavIsP1 ? input.participant2 : input.participant1;
    const nextFavProb = nextFavIsP1 ? input.next.prob1 : input.next.prob2;
    const prevSameSideProb = nextFavIsP1 ? input.previous.prob1 : input.previous.prob2;

    const line = nextFavIsP1 !== prevFavIsP1
      ? `Momentum has swung to ${nextFav} (${pct(nextFavProb)}), now ahead of ${nextUnderdog}.`
      : `${nextFav} ${nextFavProb >= prevSameSideProb ? "firmed to" : "eased to"} ${pct(nextFavProb)} (from ${pct(prevSameSideProb)}).`;

    return `${header}\n${line}\n\nNo advice here, just match context.`;
  }

  goalUpdate(input: { participant1: string; participant2: string; p1: number; p2: number; leader?: string }) {
    const leading = input.p1 === input.p2 ? "Level again" : input.p1 > input.p2 ? `${input.participant1} lead` : `${input.participant2} lead`;
    return `GOAL. ${leading} ${input.p1}-${input.p2}.\n\n${input.leader ? `${input.leader}'s pick is looking good now.` : "Leaderboard is moving."}`;
  }

  matchChange(input: {
    participant1: string;
    participant2: string;
    previous?: { participant1Score: number; participant2Score: number } | null;
    next: { participant1Score: number; participant2Score: number; state?: string | null; confirmed?: boolean | null };
    final: boolean;
  }) {
    const score = `${input.participant1} ${input.next.participant1Score}-${input.next.participant2Score} ${input.participant2}`;
    const previousScore = input.previous
      ? ` from ${input.previous.participant1Score}-${input.previous.participant2Score}`
      : "";
    const headline = input.final ? `Full-time: ${score}.` : `Score update: ${score}${previousScore}.`;
    return `${headline}${input.next.state ? `\n${input.next.state}` : ""}\n\n${input.next.confirmed ? "Confirmed." : "Live, not confirmed yet."}`;
  }

  matchStarted(input: { participant1: string; participant2: string; state?: string | null }) {
    return `We are off: ${input.participant1} vs ${input.participant2}.${input.state ? `\n${input.state}` : ""}\n\nPredictions are locked. Let the bragging rights begin.`;
  }

  leaderboardUpdate(entries: LeaderboardEntry[], final = false) {
    return `${final ? "Final leaderboard" : "Updated leaderboard"}:\n${this.leaderboard(entries)}`;
  }

  matchWinner(input: { participant1: string; participant2: string; participant1Score: number; participant2Score: number }) {
    if (input.participant1Score === input.participant2Score) {
      return null;
    }
    const winner = input.participant1Score > input.participant2Score ? input.participant1 : input.participant2;
    return `What a finish. ${winner} take the win. Big cheers to everyone who called it.`;
  }

  perfectPickWinner(entry: LeaderboardEntry) {
    return `Perfect pick. ${mention(entry)} called the exact score. Take a bow.`;
  }

  moreMatchesToTry(matches: Array<{ participant1: string; participant2: string; competition?: string | null; kickoff: string }>) {
    if (matches.length === 0) {
      return "No perfect picks this time. Ask me for available matches and we will find the next one.";
    }
    const options = matches.map((match, index) => {
      const details = [match.competition, match.kickoff].filter(Boolean).join(", ");
      return `${index + 1}. ${match.participant1} vs ${match.participant2}${details ? ` (${details})` : ""}`;
    }).join("\n");
    return `No perfect picks this time. Plenty more chances coming up:\n\n${options}\n\nMention me to start another leaderboard.`;
  }

  finalRecap(input: { participant1: string; participant2: string; p1: number; p2: number; entries: LeaderboardEntry[] }) {
    const winner = input.entries[0] ? mention(input.entries[0]) : "No winner";
    const perfectEntry = input.entries.find((entry) => entry.perfect);
    const boldestEntry = input.entries.find((entry) => entry.boldPick);
    return `Full-time: ${input.participant1} ${input.p1}-${input.p2} ${input.participant2}.\n\nWinner: ${winner}\nPerfect score: ${perfectEntry ? mention(perfectEntry) : "None"}\nBoldest pick: ${boldestEntry ? mention(boldestEntry) : "None"}`;
  }
}
