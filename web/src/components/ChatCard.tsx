import type { ReactNode } from "react";

type Speaker = {
  name: string;
  initial: string;
  avatar: string;
  nameClass: string;
  bubbleClass: string;
  isBot?: boolean;
};

const BOT: Speaker = {
  name: "Touchline",
  initial: "T",
  avatar: "bg-pitch",
  nameClass: "text-pitch",
  bubbleClass: "bg-canvas",
  isBot: true
};

const human = (name: string, avatar: string): Speaker => ({
  name,
  initial: name[0],
  avatar,
  nameClass: "text-muted",
  bubbleClass: "bg-bubble"
});

const DAMI = human("Dami", "bg-avatar-1");
const KEMI = human("Kemi", "bg-avatar-2");
const TUNDE = human("Tunde", "bg-avatar-3");

/*
  Six messages doing three jobs: it knows the fixtures, it takes a leaderboard
  request, and — the actual pitch — it gets talked to like a member and answers
  back. The closing exchange is the one that sells it. Don't cut it.
*/
const MESSAGES: Array<{ speaker: Speaker; text: string; score?: boolean }> = [
  { speaker: DAMI, text: "@touchline who are we watching tonight?" },
  { speaker: BOT, text: "Brazil vs France, 20:00. Want a leaderboard for it?" },
  { speaker: KEMI, text: "go on then — Brazil 2-1 for me" },
  { speaker: BOT, text: "Locked in.", score: true },
  { speaker: TUNDE, text: "@touchline is she actually good at this or just lucky?" },
  { speaker: BOT, text: "Three exact scorelines from nine. Lucky." }
];

function GoalCallout() {
  return (
    <>
      <p className="nums mt-[5px] text-[12.5px] font-semibold text-ink">⚽ 67' Brazil 2–1 France</p>
      <p className="mt-0.5 text-[13px] leading-[1.4] text-ink">Kemi is calling this perfectly.</p>
      <p className="mt-[5px] inline-flex items-center gap-[5px] text-[10.5px] text-signal">
        <span
          aria-hidden="true"
          className="inline-flex size-3 items-center justify-center rounded-full border-[1.5px] border-signal text-[8px] leading-none"
        >
          ✓
        </span>
        Score verified via TxLINE
      </p>
    </>
  );
}

function Avatar({ speaker }: { speaker: Speaker }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-canvas ${speaker.avatar}`}
    >
      {speaker.initial}
    </span>
  );
}

function Bubble({ speaker, children }: { speaker: Speaker; children: ReactNode }) {
  return (
    <div
      className={`max-w-[84%] rounded-[13px] rounded-bl-[4px] border border-border-subtle px-[11px] pb-2 pt-[7px] ${speaker.bubbleClass}`}
    >
      <p className={`mb-px flex items-center gap-1.5 text-[11.5px] font-bold ${speaker.nameClass}`}>
        {speaker.name}
      </p>
      {children}
    </div>
  );
}

export function ChatCard() {
  return (
    <div className="anim-card overflow-hidden rounded-[18px] border border-border-subtle bg-canvas shadow-[0_12px_32px_rgba(12,20,17,0.08)]">
      <div className="flex items-center gap-2.5 border-b border-border-subtle px-3.5 py-[11px]">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-full bg-pitch text-sm font-bold text-canvas"
        >
          ⚽
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold leading-tight">Sunday Big Match Lot</p>
          <p className="truncate text-[11.5px] text-muted">5 members</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 bg-surface px-3 pb-3.5 pt-3">
        {MESSAGES.map((msg, i) => (
          <div
            key={i}
            className="anim-msg flex items-end gap-2"
            /* 0.5s stagger, 0.75s after load — messages land like they're arriving. */
            style={{ animationDelay: `${750 + i * 500}ms` }}
          >
            <Avatar speaker={msg.speaker} />
            <Bubble speaker={msg.speaker}>
              <p className="text-[13.5px] leading-[1.4] text-ink">{msg.text}</p>
              {msg.score && <GoalCallout />}
            </Bubble>
          </div>
        ))}
      </div>
    </div>
  );
}
