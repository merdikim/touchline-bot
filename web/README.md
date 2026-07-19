# Touchline — marketing site

Single-screen landing page for the Touchline Telegram bot. Vite + React + TypeScript + Tailwind v4.

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # → dist/
pnpm preview    # serve the production build
```

## Structure

Four files. That's the whole site.

| Path | What |
|---|---|
| `src/App.tsx` | Header, hero, steps, footer, decorative backdrop |
| `src/components/ChatCard.tsx` | Group chat preview — the main conversion asset |
| `src/components/Logo.tsx` | The mark, drawn in CSS |
| `src/index.css` | Design tokens (`@theme`) and entrance choreography |
| `src/lib/constants.ts` | Bot handle and links — **change the handle here only** |
| `../brand.md` | Palette, typography, positioning, voice |

The mockup script is load-bearing. In six messages it shows the bot knowing the fixtures, taking a leaderboard request, pushing a live goal, and — the actual pitch — bantering back when someone talks to it. Keep that last exchange if you edit it.

## Motion

Ported from the source design's GSAP timeline to CSS keyframes, so the page ships without an animation runtime. Durations, delays and the 0.5s message stagger match the original; easings are the CSS equivalents of `power3.out`, `power2.inOut` and `back.out(1.6)`.

Because the entrances start at `opacity: 0`, the reduced-motion block resets each animated class to its **final** state rather than just cancelling the animation — cancelling alone would strand everything invisible.

## Conventions

- **Light theme, one screen.** `min-h-dvh` (not `h-dvh`) so short viewports scroll rather than clip the CTA.
- **Green is action, blue is proof.** Don't use the blue accent decoratively.
- **The background token is `canvas`, not `base`** — `text-base` is a Tailwind font-size utility and a colour token by that name silently collides with it.
- Numbers use `.nums` (`font-mono tabular-nums`).

The CTA points at `https://t.me/<handle>?startgroup=true`, which opens Telegram's "add to group" picker directly instead of a 1:1 chat.

## Deploy

Static output, no server:

```sh
pnpm build
pnpm wrangler pages deploy dist --project-name touchline-web
```
