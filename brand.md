# Brand — Touchline

_Status: active_

Derived from the existing Telegram profile image (`assets/touchline-telegram-profile.png`), so the site matches the bot people already see in chat.

## Palette (light)

The site is white-background and light-themed. The logo's own green and cyan are too light to sit on white — `#2FA84F` and `#38BDF8` are both under 3:1 — so both are darkened for the site while staying recognisably the same hues.

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `canvas` | `#FFFFFF` | Page background, bot bubbles | — |
| `surface` | `#FAFBFA` | Chat body | — |
| `bubble` | `#F1F5F3` | Human chat bubbles | — |
| `border-subtle` | `#E4EAE7` | Separators | — |
| `mark` / `mark-eye` | `#101512` / `#67E8F9` | Logo mark only | — |
| `avatar-1/2/3` | `#B45309` `#7C3AED` `#0F766E` | Chat avatars only — white text ≥5:1 | — |
| `ink` | `#0C1411` | Primary text | 18.7:1 on white |
| `muted` | `#5C6B66` | Secondary text | 5.6:1 on white |
| `pitch` | `#157F3B` | **Primary action.** CTA background | white text 5.1:1 |
| `pitch-bright` | `#10692F` | CTA hover (darker, not lighter, on white) | white text 6.8:1 |
| `signal` | `#0369A1` | **Verification only.** Proof chip, focus ring | 5.9:1 on white |

### Two rules that matter

**Green is action. Blue is proof.** Green appears only on things you click; the blue accent appears only where something is cryptographically verified. Spending the verification colour on decoration would make the differentiator invisible.

**The background token is `canvas`, not `base`.** `text-base` is a built-in Tailwind font-size utility, so a colour token named `base` silently collides with it — `text-base` resolves to the font size, never the colour. Do not rename it back.

## Typography

- **Inter** (400/500/600/700/800) — everything. Tight tracking at heading sizes.
- **JetBrains Mono** (400/500) — proof data only (hashes, scorelines), always via the `.nums` utility so digits don't jitter.

## Layout

Single screen. The whole site is one `min-h-dvh` centred column — logo, headline, one-line pitch, CTA, trust row, proof chip, footer.

`min-h-dvh` rather than `h-dvh` is deliberate: on very short viewports (landscape phones, heavy browser zoom) the page scrolls rather than clipping. Losing the single-screen constraint is better than losing the call to action.

## Positioning

**Touchline is a member of the group, not a tool the group operates.** Every line of copy should read as though describing a mate who joined the chat — one who happens to know every fixture and never misses a goal. Leaderboards are something it offers, not the reason it exists.

The order of the pitch: it's a new member → it knows what's on and calls the goals → it'll run a leaderboard if asked → **and you can just talk to it.** That last one is the point, not a footnote.

## Voice

Warm, dry, conversational. Short sentences. British-English football register ("what's on", "go on then", "fancies one").

- "AI mate", not "AI-powered assistant". "Invite it in", not "deploy" or "integrate".
- Proof is reassurance, not the pitch — one line, never the headline.
- Never say "revolutionary", "seamless", "leverage", "powered by cutting-edge".
- Never imply betting. Points and bragging rights only.
- The bot's own voice in the mockup is deadpan and brief. It banters back ("Three exact scorelines from nine. Lucky.") — that's what sells it as a member rather than a command line.
