import OpenAI from "openai";
import type { WorkerEnv } from "../env";

export type MessageFormatContext = {
  kind?: string;
  userMessage?: string;
  parseMode?: "HTML";
  allowGreeting?: boolean;
};

export class AiMessageFormatter {
  constructor(private readonly env: Pick<WorkerEnv, "AI_API_KEY">) {}

  async format(draft: string, context: MessageFormatContext = {}) {
    const trimmed = draft.trim();
    if (!trimmed || !this.env.AI_API_KEY) {
      return draft;
    }
    const protectedDraft = context.parseMode === "HTML" ? protectTelegramHtml(trimmed) : null;
    const draftForModel = protectedDraft?.text ?? trimmed;

    try {
      const client = new OpenAI({
        apiKey: this.env.AI_API_KEY,
        baseURL: "https://api.groq.com/openai/v1"
      });

      const response = await client.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content: [
              "You rewrite Touchline bot messages for Telegram football group chats.",
              context.allowGreeting
                ? "Make the message sound natural, warm, and human, like a concise welcome to the whole group. A short greeting like hey everyone is allowed."
                : "Make the message sound natural, warm, and human, like a concise reply to one person.",
              context.allowGreeting
                ? "Do not tag a specific user unless the draft already does."
                : "Do not start with greetings or audience callouts like hey, hi, hello, hey team, team, folks, mate, or everyone.",
              "Preserve every factual detail: team names, scores, kickoff times, competitions, points, rankings, sequence numbers, and TxLINE attribution.",
              "Do not invent fixtures, odds, scores, proofs, winners, capabilities, URLs, or user names.",
              "Keep numbered lists complete and in the same order.",
              "Avoid gambling, wagering, payout, staking, wallet, and payment language.",
              "Keep the message concise and readable on Telegram.",
              context.parseMode === "HTML"
                ? "The draft may contain Telegram HTML placeholders like __TG_HTML_0__. Preserve those placeholders exactly; do not add HTML or Markdown."
                : "Return plain text only. Do not use Markdown formatting."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              context.kind ? `Message kind: ${context.kind}` : null,
              context.userMessage ? `User message: ${context.userMessage}` : null,
              "Rewrite this draft:",
              draftForModel
            ].filter(Boolean).join("\n")
          }
        ],
        temperature: 0.7
      });

      const formatted = response.choices[0]?.message.content?.trim();
      if (!formatted) {
        return draft;
      }
      const restored = protectedDraft ? restoreTelegramHtml(formatted, protectedDraft.replacements) : formatted;
      return limitTelegramMessage(context.allowGreeting ? restored : stripAudienceGreeting(restored));
    } catch (error) {
      console.log("AI message formatting failed", error);
      return draft;
    }
  }
}

function limitTelegramMessage(text: string) {
  if (text.length <= 3900) {
    return text;
  }
  return `${text.slice(0, 3897).trimEnd()}...`;
}

function stripAudienceGreeting(text: string) {
  return text
    .replace(/^\s*(hey|hi|hello|yo)\s+(team|folks|everyone|all|mate|there)[,!:\-\s]+/i, "")
    .replace(/^\s*(hey|hi|hello|yo)[,!:\-\s]+/i, "")
    .replace(/^\s*(team|folks|everyone)[,!:\-\s]+/i, "")
    .trimStart();
}

function protectTelegramHtml(text: string) {
  const replacements: Array<{ token: string; value: string }> = [];
  const protectedText = text.replace(/<a\s+href="[^"]+">[^<]+<\/a>/g, (value) => {
    const token = `__TG_HTML_${replacements.length}__`;
    replacements.push({ token, value });
    return token;
  });
  return { text: protectedText, replacements };
}

function restoreTelegramHtml(text: string, replacements: Array<{ token: string; value: string }>) {
  return replacements.reduce((next, replacement) => next.replaceAll(replacement.token, replacement.value), text);
}
