import { eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { matchStates } from "../db/schema";

type Db = ReturnType<typeof createDb>;

export class VerificationService {
  constructor(private readonly db: Db) {}

  async summarize(matchId: string) {
    const [state] = await this.db.select().from(matchStates).where(eq(matchStates.matchId, matchId)).limit(1);
    if (!state) {
      return "No TxLINE score state stored yet. Ask me for the score and I'll refresh it.";
    }

    const confirmed = state.confirmed === 1 ? "confirmed" : "sourced";
    const seq = state.latestSeq ? ` Sequence ${state.latestSeq}.` : "";
    return `Latest score is ${confirmed} by TxLINE: ${state.participant1Score}-${state.participant2Score}.${seq}`;
  }
}
