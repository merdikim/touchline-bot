# Touchline

Touchline is a mention-based Telegram football fan agent for group chats. Invite it to a group, mention it naturally, create a match leaderboard, collect score predictions, post verified TxLINE match updates, and keep a social points table.

Touchline does not support real-money betting, wallets, staking, payments, payouts, or wagering flows. It is only for social predictions, points, leaderboards, odds-aware match context, and fan engagement.

## Stack

- TypeScript Cloudflare Worker
- Hono HTTP API
- grammY Telegram bot handling
- Cloudflare D1 with Drizzle schema
- Cloudflare Queues and Cron Triggers for polling
- OpenAI structured outputs for intent routing
- TxLINE / TXODDS for fixtures, scores, odds, and verification context

## Telegram Bot Setup

1. Open Telegram and message `@BotFather`.
2. Run `/newbot`, choose a name and username.
3. Copy the bot token into `TELEGRAM_BOT_TOKEN`.
4. Set `TELEGRAM_BOT_USERNAME` to the username without `@`.
5. Disable privacy mode with BotFather if you want prediction-looking group messages to be visible without a mention.

## Environment

Copy `.dev.vars.example` to `.dev.vars` and fill:

```txt
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=touchline
AI_API_KEY=
TXLINE_BASE_URL=
TXLINE_JWT=
TXLINE_API_TOKEN=
NODE_ENV=development
```

TxLINE requests send both required headers:

```txt
Authorization: Bearer <TXLINE_JWT>
X-Api-Token: <TXLINE_API_TOKEN>
```

### TxLINE Free World Cup Credentials

The Worker is configured for TxLINE devnet by default:

```txt
TXLINE_BASE_URL=https://txline-dev.txodds.com
```

To create the guest JWT and activated API token, run the setup script with a funded Solana keypair. It subscribes to TxLINE's free World Cup service level, starts a guest JWT session, signs the activation payload, activates the API token, and runs a fixtures smoke test.

```sh
pnpm setup:txline -- --network devnet --keypair ~/.config/solana/id.json
```

You can also pass the private key directly. The script accepts a base58 secret key, a Solana JSON byte array, or comma-separated bytes. Prefer an environment variable so the key is less likely to land in shell history:

```sh
SOLANA_PRIVATE_KEY='[1,2,...]' pnpm setup:txline -- --network devnet
```

Defaults match the documented free devnet tier: service level `1`, `4` weeks, and no custom league list. Useful options:

```sh
pnpm setup:txline -- --private-key '<base58-or-json-secret-key>'
pnpm setup:txline -- --network mainnet --service-level 12
pnpm setup:txline -- --tx-sig <existing-subscription-transaction>
pnpm setup:txline -- --leagues 501,804,202
pnpm setup:txline -- --no-smoke
```

Keep one network consistent for every value: Solana RPC, TxLINE program ID, subscription transaction, guest JWT host, activation host, and `TXLINE_BASE_URL`. The script prints the `TXLINE_JWT` and `TXLINE_API_TOKEN` values to place in `.dev.vars` locally and in Wrangler secrets for deploy.

## D1 Setup

Create a D1 database:

```sh
pnpm wrangler d1 create touchline
```

Paste the returned database id into `wrangler.toml`, then run migrations:

```sh
pnpm db:migrate:local
pnpm db:migrate:remote
```

## Local Development

Install dependencies:

```sh
pnpm install
```

Run the Worker:

```sh
pnpm dev
```

Health check:

```sh
curl http://localhost:8787/health
```

## Telegram Webhook

After deploy, set the webhook:

```sh
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://YOUR_WORKER.workers.dev/webhooks/telegram","allowed_updates":["message","my_chat_member"]}'
```

For local Telegram testing, expose Wrangler with a tunnel and use the public tunnel URL.

## TxLINE Smoke Test

```sh
TXLINE_BASE_URL=... TXLINE_JWT=... TXLINE_API_TOKEN=... pnpm smoke:txline
```

The script calls `/api/fixtures/snapshot` and prints the status plus the first part of the response.

## Deploy

```sh
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put AI_API_KEY
wrangler secret put TXLINE_JWT
wrangler secret put TXLINE_API_TOKEN
pnpm deploy
```

Set non-secret values in `wrangler.toml` or via Wrangler vars.

## Example Interactions

```txt
@touchline create a leaderboard for Brazil vs France
```

```txt
Brazil 2-1
```

```txt
@touchline who's winning?
```

```txt
@touchline what's the score?
```

```txt
@touchline who has momentum?
```

```txt
@touchline verify the score
```

Demo mode:

```txt
@touchline run demo
```

## Worker Routes

- `POST /webhooks/telegram`
- `GET /health`
- `POST /internal/poll-match`

`/internal/poll-match` accepts a queue job body:

```json
{
  "groupMatchId": "group_match_...",
  "matchId": "txline_match_...",
  "txlineFixtureId": 123
}
```

If no full job is provided, it enqueues currently active group matches.

## MVP Limitations

- Polling is used instead of TxLINE streams.
- AI is used only for intent routing; templates own product replies.
- Demo mode creates a reliable Brazil vs France round even without a live match.
- Ambiguous fixture selection returns options, but numbered follow-up selection is intentionally minimal for the MVP.
- Odds commentary is contextual only and never advice.
