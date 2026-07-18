import type { WorkerEnv } from "../env";
import { normalizeFixtures, normalizeOddsSummary, normalizeScoreProof, normalizeScoreState, STAT_KEY_PARTICIPANT1_SCORE, STAT_KEY_PARTICIPANT2_SCORE } from "./normalizers";
import type { NormalizedFixture, NormalizedScoreState, OddsSummary, ScoreProof } from "./types";

export class TxLineClient {
  constructor(private readonly env: Pick<WorkerEnv, "TXLINE_BASE_URL" | "TXLINE_JWT" | "TXLINE_API_TOKEN">) {}

  async getFixtures(params: { q?: string } = {}): Promise<NormalizedFixture[]> {
    const raw = await this.get("/api/fixtures/snapshot", params);
    return normalizeFixtures(raw);
  }

  async getScoreSnapshot(fixtureId: number): Promise<NormalizedScoreState> {
    const raw = await this.get(`/api/scores/snapshot/${fixtureId}`);
    return normalizeScoreState(fixtureId, raw);
  }

  async getScoreUpdates(fixtureId: number): Promise<NormalizedScoreState[]> {
    const raw = await this.get(`/api/scores/updates/${fixtureId}`);
    const list = Array.isArray(raw) ? raw : [];
    return list.map((item) => normalizeScoreState(fixtureId, item));
  }

  async getHistoricalScores(fixtureId: number): Promise<NormalizedScoreState[]> {
    const raw = await this.get(`/api/scores/historical/${fixtureId}`);
    const list = Array.isArray(raw) ? raw : [];
    return list.map((item) => normalizeScoreState(fixtureId, item));
  }

  async getOddsSnapshot(fixtureId: number, asOf?: string, participant1 = "Participant 1", participant2 = "Participant 2"): Promise<OddsSummary> {
    const raw = await this.get(`/api/odds/snapshot/${fixtureId}`, { asOf });
    return normalizeOddsSummary(raw, participant1, participant2);
  }

  async getOddsUpdates(fixtureId: number): Promise<OddsSummary[]> {
    const raw = await this.get(`/api/odds/updates/${fixtureId}`);
    const list = Array.isArray(raw) ? raw : [];
    return list.map((item) => normalizeOddsSummary(item, "Participant 1", "Participant 2"));
  }

  /**
   * Fetches the Merkle proof linking both participant scores at `seq` to the batch
   * root TxLINE publishes on Solana.
   *
   * Returns null when TxLINE has no processed record for (fixtureId, seq) — that is a
   * 404 and an expected state, not a failure: only anchored score events are provable,
   * so a just-received live update has no proof until its batch is committed.
   */
  async getScoreProof(fixtureId: number, seq: number): Promise<ScoreProof | null> {
    const raw = await this.get("/api/scores/stat-validation", {
      fixtureId: String(fixtureId),
      seq: String(seq),
      statKey: String(STAT_KEY_PARTICIPANT1_SCORE),
      statKey2: String(STAT_KEY_PARTICIPANT2_SCORE)
    }, { allowNotFound: true });

    return raw === null ? null : normalizeScoreProof(fixtureId, seq, raw);
  }

  private async get(path: string, params: Record<string, string | undefined> = {}, options: { allowNotFound?: boolean } = {}): Promise<unknown> {
    const url = new URL(path, this.env.TXLINE_BASE_URL);
    for (const [key, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.env.TXLINE_JWT}`,
        "X-Api-Token": this.env.TXLINE_API_TOKEN,
        Accept: "application/json"
      }
    });

    if (response.status === 404 && options.allowNotFound) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TxLINE ${response.status}: ${body.slice(0, 500)}`);
    }

    return response.json();
  }
}
