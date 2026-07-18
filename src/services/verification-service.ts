import { eq } from "drizzle-orm";
import type { createDb } from "../db/client";
import { matchStates } from "../db/schema";
import type { TxLineClient } from "../txline/client";
import type { ScoreProof } from "../txline/types";
import { log } from "../utils/logger";

type Db = ReturnType<typeof createDb>;

function rootFingerprint(bytes: number[] | undefined) {
  if (!bytes || bytes.length === 0) {
    return null;
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class VerificationService {
  constructor(private readonly db: Db, private readonly txline: TxLineClient) {}

  /**
   * Answers "prove it" by fetching the Merkle proof for the stored score from
   * TxLINE and reporting what the proof actually says — not what our cache says.
   */
  async summarize(matchId: string, fixtureId: number) {
    const [state] = await this.db.select().from(matchStates).where(eq(matchStates.matchId, matchId)).limit(1);
    if (!state) {
      return "No TxLINE score state stored yet. Ask me for the score and I'll refresh it.";
    }

    const cached = `${state.participant1Score}-${state.participant2Score}`;

    if (state.latestSeq === null || state.latestSeq === undefined) {
      return `Latest score I have from TxLINE is ${cached}, but it arrived without a sequence number, so I can't pull a proof for it yet.`;
    }

    let proof: ScoreProof | null;
    try {
      proof = await this.txline.getScoreProof(fixtureId, state.latestSeq);
    } catch (error) {
      log("warn", "txline score proof failed", { matchId, fixtureId, seq: state.latestSeq, error: String(error) });
      return `Latest score from TxLINE is ${cached} (sequence ${state.latestSeq}). I couldn't reach the proof endpoint just now, so treat that as unverified until I can.`;
    }

    if (!proof) {
      return `Latest score from TxLINE is ${cached} (sequence ${state.latestSeq}). That update isn't anchored on Solana yet, so there's no proof to show — updates become provable once their batch is committed.`;
    }

    return this.describe(proof, cached);
  }

  private describe(proof: ScoreProof, cached: string) {
    const root = rootFingerprint(proof.eventStatsSubTreeRoot);
    const lines: string[] = [];

    if (proof.participant1Score === undefined || proof.participant2Score === undefined) {
      lines.push(`TxLINE returned a proof for sequence ${proof.seq}, but it didn't carry both score stats, so I can only confirm the update exists — not the ${cached} scoreline itself.`);
    } else {
      const proven = `${proof.participant1Score}-${proof.participant2Score}`;
      lines.push(
        proven === cached
          ? `Verified: ${proven}.`
          : `Heads up — my cached score was ${cached}, but the proof says ${proven}. Going with the proof.`
      );
      lines.push("");
      lines.push(`That scoreline is cryptographically committed by TxLINE, not just reported by it.`);
    }

    lines.push("");
    lines.push(`Fixture ${proof.fixtureId}, sequence ${proof.seq}`);
    if (proof.ts) {
      lines.push(`Committed ${new Date(proof.ts).toISOString().replace("T", " ").slice(0, 19)} UTC`);
    }
    if (root) {
      lines.push(`Merkle root ${root.slice(0, 12)}...${root.slice(-8)}`);
    }
    lines.push(`${proof.proofDepth} proof hashes link it to the batch root published on Solana.`);

    return lines.join("\n");
  }
}
