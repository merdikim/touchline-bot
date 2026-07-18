# Touchline

**A Telegram football agent that turns any group chat into a prediction league — with every scoreline backed by a cryptographic proof anchored on Solana.**

Built for the TxODDS *Consumer and Fan Experiences* track.

---

## The problem

Every football group chat already runs a prediction league. It runs on memory, screenshots, and arguing.

Someone calls 2-1. Someone else swears they said 2-1 first. The match ends and nobody agrees on who won, because the "source of truth" was whoever shouted loudest with a livescore app open. The social layer of football fandom has no referee.

## What Touchline does

Invite it to a group, mention it in plain English, and it runs the league for you:

- **Prediction leagues** — `@touchline create a leaderboard for Brazil vs France`, then everyone just types `Brazil 2-1` in chat. Predictions lock automatically at kickoff.
- **Live match updates** — kickoff, goals, and full-time pushed into the group as they happen.
- **Scored leaderboards** — exact scores, correct results, and odds-aware bonuses, settled the moment the whistle goes.
- **Odds-aware commentary** — implied probabilities and pre-match odds movement, as context and banter. Never as advice.
- **Verifiable scores** — ask `@touchline verify the score` and it returns a real Merkle proof, not a promise.

No wallets. No betting. No payments, staking, wagering, or payouts. Touchline is a social layer: points, bragging rights, and provable scorelines.

## Why this needs TxLINE

Any bot can print a scoreline from an API. The reason to argue about that scoreline is that you have to trust whoever served it.

TxLINE hashes every score update into a three-level Merkle hierarchy and publishes the batch root to Solana. So a score isn't just *reported* — it's *committed*, at an exact timestamp, to a ledger nobody in the group controls.

Touchline puts that in front of fans in the one place it settles arguments:

```txt
@touchline verify the score
```

```txt
Verified: 2-1.

That scoreline is cryptographically committed by TxLINE, not just reported by it.

Fixture 18257865, sequence 12
Committed 2026-07-15 21:06:25 UTC
Merkle root 12dd92f56a6e...c63ffeec
6 proof hashes link it to the batch root published on Solana.
```

That output is a live `GET /api/scores/stat-validation` call ([`src/txline/client.ts`](src/txline/client.ts)), requesting stat keys `1` and `2` — both participant scores — for the exact sequence number the leaderboard was settled on. The values shown are the ones read out of the proof, not out of our cache. If the two ever disagree, [the proof wins and the bot says so](src/services/verification-service.ts).

The leaderboard is settled from data a fan can independently check. That's the difference between a group chat bot and a referee.

## TxLINE endpoints used

| Endpoint | Used for |
|---|---|
| `GET /api/fixtures/snapshot` | Fixture search, team and date filtering |
| `GET /api/scores/snapshot/{fixtureId}` | Live score polling, leaderboard settlement |
| `GET /api/odds/snapshot/{fixtureId}` | 1X2 market read, implied probabilities, odds-movement alerts |
| `GET /api/scores/stat-validation` | **Merkle proof for the settled scoreline** |

Odds parsing normalizes the 1X2 market to implied probabilities, preferring TxLINE's `Pct` fields and falling back to decimal odds, then removes the overround so the numbers shown to fans actually sum to 100% ([`src/txline/normalizers.ts`](src/txline/normalizers.ts)).

## Architecture

```
Telegram ──webhook──▶ Cloudflare Worker (Hono + grammY)
                            │
                  ┌─────────┼──────────┐
                  ▼         ▼          ▼
             Intent      Services    TxLINE API
             router      (match,     (fixtures,
             (LLM, 12    leaderboard, scores, odds,
             intents)    predictions, proofs)
                         verification)
                            │
                            ▼
                     Cloudflare D1 (Drizzle)
                            ▲
                            │
              Cron (1 min) ─┴─ live scores, odds movement, reminders
```

- **TypeScript Cloudflare Worker** — Hono HTTP, grammY Telegram handling
- **Cloudflare D1 + Drizzle** — groups, matches, predictions, cached score state
- **Cron Triggers + Queues** — live score polling, odds-movement alerts, pre-kickoff reminders
- **LLM intent routing** — natural language in the group maps to 12 structured intents via JSON-schema-constrained output. The model routes; templates own the facts.
- **TxLINE / TxODDS** — fixtures, scores, odds, and on-chain proofs

**Design note:** the LLM never invents match data. It classifies what a user meant, and a separate formatting pass adjusts tone. Every scoreline, leaderboard, and proof value is rendered from TxLINE data by template code.

## Quickstart

```sh
pnpm install
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars`:

```txt
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=touchline
AI_API_KEY=
TXLINE_BASE_URL=https://txline-dev.txodds.com
TXLINE_JWT=
TXLINE_API_TOKEN=
NODE_ENV=development
```

### 1. Telegram bot

1. Message [@BotFather](https://t.me/BotFather), run `/newbot`, pick a name and username.
2. Put the token in `TELEGRAM_BOT_TOKEN` and the username (no `@`) in `TELEGRAM_BOT_USERNAME`.
3. Disable privacy mode in BotFather so prediction messages like `Brazil 2-1` are visible without a mention.

### 2. TxLINE credentials (free World Cup tier)

TxLINE access is gated by an on-chain subscription. The setup script subscribes to the free World Cup service level on devnet, opens a guest JWT session, signs the activation payload with your Solana keypair, activates the API token, and runs a fixtures smoke test:

```sh
pnpm setup:txline -- --network devnet --keypair ~/.config/solana/id.json
```

Or pass the key directly — prefer the env var so it stays out of shell history:

```sh
SOLANA_PRIVATE_KEY='[1,2,...]' pnpm setup:txline -- --network devnet
```

Accepts a base58 secret key, a Solana JSON byte array, or comma-separated bytes. Useful options:

```sh
pnpm setup:txline -- --network mainnet --service-level 12
pnpm setup:txline -- --tx-sig <existing-subscription-transaction>
pnpm setup:txline -- --leagues 501,804,202
pnpm setup:txline -- --no-smoke
```

Keep one network consistent across every value: Solana RPC, TxLINE program ID, subscription transaction, guest JWT host, activation host, and `TXLINE_BASE_URL`. The script prints the `TXLINE_JWT` and `TXLINE_API_TOKEN` to paste into `.dev.vars`.

Requests send both required headers:

```txt
Authorization: Bearer <TXLINE_JWT>
X-Api-Token: <TXLINE_API_TOKEN>
```

Verify connectivity any time:

```sh
TXLINE_BASE_URL=... TXLINE_JWT=... TXLINE_API_TOKEN=... pnpm smoke:txline
```

### 3. Database

```sh
pnpm wrangler d1 create touchline   # paste the returned id into wrangler.toml
pnpm db:migrate:local
pnpm db:migrate:remote
```

### 4. Run

```sh
pnpm dev
curl http://localhost:8787/health
```

For local Telegram testing, expose Wrangler with a tunnel and register the tunnel URL as the webhook.

### 5. Deploy

```sh
pnpm run deploy
```

Uploads every key from `.dev.vars` to Worker secrets, applies remote D1 migrations, then deploys. Keep `.dev.vars` out of git.

Then register the webhook:

```sh
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR_WORKER.workers.dev/webhooks/telegram","allowed_updates":["message","my_chat_member"]}'
```

## Try it

Add the bot to a group, then:

```txt
@touchline create a leaderboard for Brazil vs France
Brazil 2-1
@touchline what's the score?
@touchline who has momentum?
@touchline verify the score
@touchline leaderboard
```

No live match on right now? Run a scripted round that plays out over a few minutes:

```txt
@touchline run demo
```

## Worker routes

| Route | Purpose |
|---|---|
| `POST /webhooks/telegram` | Telegram update handler |
| `GET /health` | Health check |
| `POST /internal/poll-match` | Queue job entry point for score polling |

`/internal/poll-match` accepts a job body, or enqueues all currently active group matches when called with none:

```json
{
  "groupMatchId": "group_match_...",
  "matchId": "txline_match_...",
  "txlineFixtureId": 123
}
```

## Roadmap

Honest about where the edges are:

- **Proof fetch, not yet on-chain execution.** Touchline fetches the real Merkle proof and reports the committed values. Running `validateStat` against the Solana program to verify the proof client-side is the next step — it would let the bot prove the scoreline without trusting the API response at all.
- **Polling, not streaming.** Scores come from `/snapshot` on a one-minute cron. TxLINE offers `/stream`; moving to it would cut update latency to near-real-time.
- **Proof latency.** Live updates only become provable once their batch is anchored, so `verify` on a just-scored goal reports "not anchored yet" rather than inventing a proof.
- **Single-sport.** Soccer stat keys only. The scores API also covers American football and basketball.

## Scope

Touchline supports social predictions, points, leaderboards, odds-aware context, and fan engagement. It deliberately supports no real-money betting, wallets, staking, payments, payouts, or wagering.
