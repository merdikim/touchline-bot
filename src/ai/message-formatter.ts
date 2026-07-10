import OpenAI from "openai";
import type { WorkerEnv } from "../env";

export type MessageFormatContext = {
  kind?: string;
  userMessage?: string;
  parseMode?: "HTML";
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
              "Make the message sound natural, warm, and human, like a concise group-chat reply.",
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
      return limitTelegramMessage(restored);
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
