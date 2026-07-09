import type { LeaderboardEntry } from "./leaderboard-service";

export class CommentaryService {
  groupIntro() {
    return [
      "Yo, thanks for adding me.",
      "",
      "I am here for match days: set up prediction leaderboards, keep score with live updates, and give bragging rights when someone nails it.",
      "",
      "Just mention me with a game when you are ready, like: @touchline Brazil vs France"
    ].join("\n");
  }

  createdMatch(input: { participant1: string; participant2: string; competition?: string | null; kickoff: string }) {
    const competition = input.competition ? `\n${input.competition}` : "";
    return `I'm in. ${input.participant1} vs ${input.participant2}${competition}\nKicks off ${input.kickoff}.\n\nDrop your predictions before kickoff.\nExample: ${input.participant1} 2-1\n\nVerified by TxLINE.`;
  }

  ambiguous(fixtures: Array<{ participant1: string; participant2: string; competition?: string | null; startTime: string }>) {
    const options = fixtures.map((fixture, index) => {
      const details = [fixture.competition, fixture.startTime].filter(Boolean).join(", ");
      return `${index + 1}. ${fixture.participant1} vs ${fixture.participant2}${details ? ` (${details})` : ""}`;
    }).join("\n");
    return `I found a few possible matches:\n\n${options}\n\nMention me with a clearer team or competition name.`;
  }

  noMatch() {
    return "I couldn't find that fixture in TxLINE yet. Try the team names or ask me for available matches.";
  }

  predictionLocked(input: { displayName: string; participant1: string; participant2: string; score: string }) {
    return `Locked in: ${input.displayName} has ${input.participant1} ${input.score} ${input.participant2}.`;
  }

  leaderboard(entries: LeaderboardEntry[]) {
    if (entries.length === 0) {
      return "No predictions locked yet. First brave pick gets the early spotlight.";
    }
    return entries.map((entry, index) => `${index + 1}. ${entry.displayName} - ${entry.points} pts (${entry.prediction})`).join("\n");
  }

  status(input: { participant1: string; participant2: string; competition?: string | null; participant1Score: number; participant2Score: number; state?: string | null; confirmed?: boolean | null }) {
    return `${input.participant1} ${input.participant1Score}-${input.participant2Score} ${input.participant2}${input.competition ? `\n${input.competition}` : ""}${input.state ? `\n${input.state}` : ""}\n\n${input.confirmed ? "Verified by TxLINE." : "Sourced from TxLINE."}`;
  }

  odds(input: { favorite?: string; underdog?: string; movement?: string }) {
    const parts = [];
    if (input.favorite) {
      parts.push(`${input.favorite} look like the market favorite right now.`);
    }
    if (input.underdog) {
      parts.push(`${input.underdog} would be the bold pick.`);
    }
    if (input.movement && input.movement !== "unknown") {
      parts.push(`Market moved ${input.movement.replaceAll("_", " ")}.`);
    }
    return `${parts.join(" ") || "No clear market momentum from the latest TxLINE odds snapshot."}\n\nNo advice here, just match context.`;
  }

  goalUpdate(input: { participant1: string; participant2: string; p1: number; p2: number; leader?: string }) {
    const leading = input.p1 === input.p2 ? "Level again" : input.p1 > input.p2 ? `${input.participant1} lead` : `${input.participant2} lead`;
    return `GOAL. ${leading} ${input.p1}-${input.p2}.\n\n${input.leader ? `${input.leader}'s pick is looking good now.` : "Leaderboard is moving."}\n\nVerified by TxLINE.`;
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
    return `${headline}${input.next.state ? `\n${input.next.state}` : ""}\n\n${input.next.confirmed ? "Verified by TxLINE." : "Sourced from TxLINE."}`;
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
    const mention = `<a href="tg://user?id=${escapeHtmlAttribute(entry.platformUserId)}">${escapeHtml(entry.displayName)}</a>`;
    return `Perfect pick. ${mention} called the exact score. Take a bow.`;
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
    const winner = input.entries[0]?.displayName ?? "No winner";
    const perfect = input.entries.find((entry) => entry.perfect)?.displayName ?? "None";
    const boldest = input.entries.find((entry) => entry.boldPick)?.displayName ?? "None";
    return `Full-time: ${input.participant1} ${input.p1}-${input.p2} ${input.participant2}.\n\nWinner: ${winner}\nPerfect score: ${perfect}\nBoldest pick: ${boldest}\n\nVerified by TxLINE.`;
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
