import { and, eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { groupMatches, matches, predictions } from "../db/schema";
import { isBeforeKickoff } from "../utils/dates";
import { newId } from "../utils/ids";

type Db = ReturnType<typeof createDb>;

export type ParsedPrediction = {
  participant1Score: number;
  participant2Score: number;
  predictedWinner?: string;
};

export class PredictionService {
  constructor(private readonly db: Db) {}

  parse(raw: string, match: Pick<typeof matches.$inferSelect, "participant1" | "participant2">): ParsedPrediction | null {
    const score = raw.match(/(\d{1,2})\s*[-:]\s*(\d{1,2})/);
    if (!score) {
      return null;
    }

    let first = Number(score[1]);
    let second = Number(score[2]);
    const lower = raw.toLowerCase();
    const participant2MentionedFirst = lower.indexOf(match.participant2.toLowerCase()) >= 0
      && (lower.indexOf(match.participant1.toLowerCase()) < 0 || lower.indexOf(match.participant2.toLowerCase()) < lower.indexOf(match.participant1.toLowerCase()));

    if (participant2MentionedFirst) {
      [first, second] = [second, first];
    }

    return {
      participant1Score: first,
      participant2Score: second,
      predictedWinner: first === second ? "draw" : first > second ? "participant1" : "participant2"
    };
  }

  async submit(input: { groupMatchId: string; userId: string; match: typeof matches.$inferSelect; rawPrediction: string }) {
    const [groupMatch] = await this.db.select().from(groupMatches).where(eq(groupMatches.id, input.groupMatchId)).limit(1);
    if (!groupMatch || groupMatch.predictionsOpen !== 1 || !isBeforeKickoff(input.match.startTime)) {
      await this.db.update(groupMatches).set({ predictionsOpen: 0, updatedAt: new Date().toISOString() }).where(eq(groupMatches.id, input.groupMatchId));
      return { ok: false as const, reason: "Predictions are locked for this match." };
    }

    const parsed = this.parse(input.rawPrediction, input.match);
    if (!parsed) {
      return { ok: false as const, reason: `Send it like "${input.match.participant1} 2-1" or "1-1 draw".` };
    }

    const existing = await this.db.select().from(predictions).where(and(eq(predictions.groupMatchId, input.groupMatchId), eq(predictions.userId, input.userId))).limit(1);
    const id = existing[0]?.id ?? newId("prediction");
    await this.db.insert(predictions).values({
      id,
      groupMatchId: input.groupMatchId,
      userId: input.userId,
      participant1Score: parsed.participant1Score,
      participant2Score: parsed.participant2Score,
      predictedWinner: parsed.predictedWinner ?? null
    }).onConflictDoUpdate({
      target: [predictions.groupMatchId, predictions.userId],
      set: {
        participant1Score: parsed.participant1Score,
        participant2Score: parsed.participant2Score,
        predictedWinner: parsed.predictedWinner ?? null,
        updatedAt: new Date().toISOString()
      }
    });

    return { ok: true as const, prediction: parsed };
  }
}
