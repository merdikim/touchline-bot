import { desc, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { matchStates, predictions, users } from "../db/schema";
import type { OddsSummary } from "../txline/types";

type Db = ReturnType<typeof createDb>;

export type LeaderboardEntry = {
  userId: string;
  platformUserId: string;
  displayName: string;
  prediction: string;
  points: number;
  perfect: boolean;
  boldPick: boolean;
};

export class LeaderboardService {
  constructor(private readonly db: Db) {}

  async calculate(groupMatchId: string, matchId: string, baselineOddsSummary?: string | null): Promise<LeaderboardEntry[]> {
    const [state] = await this.db.select().from(matchStates).where(eq(matchStates.matchId, matchId)).limit(1);
    const rows = await this.db
      .select({ prediction: predictions, user: users })
      .from(predictions)
      .innerJoin(users, eq(predictions.userId, users.id))
      .where(eq(predictions.groupMatchId, groupMatchId))
      .orderBy(desc(predictions.points));

    const odds = parseOdds(baselineOddsSummary);
    const entries = rows.map(({ prediction, user }) => {
      const points = state ? scorePrediction(prediction, state, odds) : 0;
      return {
        userId: user.id,
        platformUserId: user.platformUserId,
        displayName: user.displayName ?? user.username ?? "A fan",
        prediction: `${prediction.participant1Score}-${prediction.participant2Score}`,
        points,
        perfect: Boolean(state && prediction.participant1Score === state.participant1Score && prediction.participant2Score === state.participant2Score),
        boldPick: Boolean(odds?.underdog && prediction.predictedWinner && prediction.predictedWinner !== "draw")
      };
    });

    return entries.sort((a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName));
  }
}

function scorePrediction(
  prediction: typeof predictions.$inferSelect,
  state: typeof matchStates.$inferSelect,
  odds: OddsSummary | null
): number {
  let points = 1;
  const predictedResult = prediction.participant1Score === prediction.participant2Score ? "draw" : prediction.participant1Score > prediction.participant2Score ? "participant1" : "participant2";
  const actualResult = state.participant1Score === state.participant2Score ? "draw" : state.participant1Score > state.participant2Score ? "participant1" : "participant2";

  if (predictedResult === actualResult) {
    points += 3;
  }
  if (prediction.participant1Score === state.participant1Score && prediction.participant2Score === state.participant2Score) {
    points += 5;
  }
  if (odds?.underdog && predictedResult !== "draw") {
    points += 2;
  }
  return points;
}

function parseOdds(raw?: string | null): OddsSummary | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as OddsSummary;
  } catch {
    return null;
  }
}
