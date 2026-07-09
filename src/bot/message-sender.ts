import type { WorkerEnv } from "../env";

export class TelegramMessageSender {
  constructor(private readonly env: Pick<WorkerEnv, "TELEGRAM_BOT_TOKEN">) {}

  async sendMessage(chatId: string, text: string, options: { parseMode?: "HTML" } = {}) {
    const response = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options.parseMode,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      throw new Error(`Telegram sendMessage failed: ${response.status}`);
    }
  }
}
