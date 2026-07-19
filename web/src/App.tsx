import { ChatCard } from "./components/ChatCard";
import { Logo } from "./components/Logo";
import { ADD_TO_GROUP_URL } from "./lib/constants";

const STEPS = [
  { num: "01", title: "Invite it in", body: "tap the button, pick your group chat." },
  { num: "02", title: "It settles in", body: "knows what's on, calls the goals as they go in." },
  { num: "03", title: "The group takes over", body: "fancy a leaderboard? It runs one. Points only." }
];

/** Decorative floodlight wash and pitch markings behind the page. */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(165deg,#F4F9F5_0%,#FFFFFF_40%,#F0F7F2_75%,#FFFFFF_100%)]" />
      <div className="anim-glow-1 absolute -right-[140px] -top-[180px] size-[600px] rounded-full bg-[radial-gradient(circle,rgba(21,127,59,0.13)_0%,rgba(21,127,59,0)_65%)] blur-[10px]" />
      <div className="anim-glow-2 absolute -bottom-[200px] -left-[220px] size-[560px] rounded-full bg-[radial-gradient(circle,rgba(3,105,161,0.07)_0%,rgba(3,105,161,0)_65%)] blur-[10px]" />
      <div className="absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(21,127,59,0.05)_0px,rgba(21,127,59,0.05)_1px,transparent_1px,transparent_90px)]" />
      <div className="anim-sideline absolute inset-x-0 top-16 h-0.5 bg-[linear-gradient(90deg,transparent,rgba(21,127,59,0.35),transparent)]" />
    </div>
  );
}

export default function App() {
  return (
    /*
      One screen. `overflow-auto` rather than hidden so short viewports scroll
      instead of clipping the call to action.
    */
    <div className="relative flex h-dvh flex-col overflow-auto bg-canvas">
      <Backdrop />

      <div className="relative flex min-h-full flex-col">
        <header className="mx-auto flex w-full shrink-0 items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <Logo />
            <span className="text-base font-bold tracking-tight">Touchline</span>
          </div>
          <a
            href={ADD_TO_GROUP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded-[10px] bg-pitch px-[18px] text-sm font-semibold text-canvas transition-colors duration-100 ease-out hover:bg-pitch-bright"
          >
            Add to your group
          </a>
        </header>

        <main className="mx-auto flex w-full max-w-[1160px] flex-1 items-center px-6 pb-2 pt-3">
          <div className="flex w-full flex-wrap items-center gap-[clamp(28px,4vw,64px)]">
            <div className="min-w-[300px] flex-[1_1_400px]">
              <h1 className="anim-hero mb-4 text-balance text-[clamp(30px,4.4vw,50px)] font-extrabold leading-[1.05] tracking-[-0.03em]">
                Your group chat just got a new member.
              </h1>

              <p className="anim-hero mb-[22px] max-w-[46ch] text-pretty text-[clamp(15px,1.4vw,18px)] leading-[1.55] text-muted [animation-delay:120ms]">
                Touchline is an AI mate you invite into your football group. It knows what's on,
                calls the goals as they happen, and spins up a leaderboard whenever the group
                fancies one. Best part, you can just talk to it.
              </p>

              <div className="anim-hero mb-[22px] flex flex-col items-start gap-3 [animation-delay:240ms]">
                <a
                  href={ADD_TO_GROUP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="group inline-flex min-h-[50px] items-center gap-2.5 rounded-xl bg-pitch px-[26px] text-base font-bold text-canvas transition-[background-color,transform] duration-100 ease-out hover:bg-pitch-bright active:translate-y-px"
                >
                  Add Touchline to your group
                  <span
                    aria-hidden="true"
                    className="text-lg transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none"
                  >
                    →
                  </span>
                </a>
                <p className="text-[13.5px] text-muted">
                  No wallet needed &nbsp;·&nbsp; Not a betting app
                </p>
              </div>

              <ol className="anim-hero flex max-w-[490px] flex-col gap-2 border-t-2 border-border-subtle pt-[18px] [animation-delay:360ms]">
                {STEPS.map((step) => (
                  <li key={step.num} className="flex items-baseline gap-3">
                    <span className="nums shrink-0 text-xs font-semibold text-pitch">{step.num}</span>
                    <p className="text-sm leading-[1.5] text-muted">
                      <strong className="font-semibold text-ink">{step.title}</strong> — {step.body}
                    </p>
                  </li>
                ))}
              </ol>
            </div>

            <div className="mx-auto min-w-[300px] max-w-[440px] flex-[1_1_340px]">
              <ChatCard />
            </div>
          </div>
        </main>

        <footer className="mx-auto w-full shrink-0 px-6 pb-3.5 pt-2.5">
          <div className="mb-2.5 h-0.5 bg-border-subtle" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-muted">
              Not gambling. Points and bragging rights only. No wallet needed.
            </p>
            <p className="font-mono text-[11.5px] text-muted">
              Scores verified against proofs anchored on Solana. Powered by TxLINE
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
