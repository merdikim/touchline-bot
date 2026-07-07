import type { LeaderboardEntry } from "./leaderboard-service";

export class CommentaryService {
  createdMatch(input: { participant1: string; participant2: string; kickoff: string }) {
    return `I'm in. ${input.participant1} vs ${input.participant2} kicks off ${input.kickoff}.\n\nDrop your predictions before kickoff.\nExample: ${input.participant1} 2-1\n\nVerified by TxLINE.`;
  }

  ambiguous(fixtures: Array<{ participant1: string; participant2: string; startTime: string }>) {
    const options = fixtures.map((fixture, index) => `${index + 1}. ${fixture.participant1} vs ${fixture.participant2} (${fixture.startTime})`).join("\n");
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

  status(input: { participant1: string; participant2: string; participant1Score: number; participant2Score: number; state?: string | null; confirmed?: boolean | null }) {
    return `${input.participant1} ${input.participant1Score}-${input.participant2Score} ${input.participant2}${input.state ? `\n${input.state}` : ""}\n\n${input.confirmed ? "Verified by TxLINE." : "Sourced from TxLINE."}`;
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

  finalRecap(input: { participant1: string; participant2: string; p1: number; p2: number; entries: LeaderboardEntry[] }) {
    const winner = input.entries[0]?.displayName ?? "No winner";
    const perfect = input.entries.find((entry) => entry.perfect)?.displayName ?? "None";
    const boldest = input.entries.find((entry) => entry.boldPick)?.displayName ?? "None";
    return `Full-time: ${input.participant1} ${input.p1}-${input.p2} ${input.participant2}.\n\nWinner: ${winner}\nPerfect score: ${perfect}\nBoldest pick: ${boldest}\n\nVerified by TxLINE.`;
  }
}
