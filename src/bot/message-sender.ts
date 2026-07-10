import type { WorkerEnv } from "../env";
import { AiMessageFormatter, type MessageFormatContext } from "../ai/message-formatter";

export class TelegramMessageSender {
  private readonly formatter: AiMessageFormatter;

  constructor(private readonly env: Pick<WorkerEnv, "TELEGRAM_BOT_TOKEN" | "AI_API_KEY">) {
    this.formatter = new AiMessageFormatter(env);
  }

  async sendMessage(chatId: string, text: string, options: { parseMode?: "HTML"; formatContext?: MessageFormatContext } = {}) {
    const formatted = await this.formatter.format(text, {
      ...options.formatContext,
      parseMode: options.parseMode
    });
    const response = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatted,
        parse_mode: options.parseMode,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed: ${response.status}`);
    }
  }
}
