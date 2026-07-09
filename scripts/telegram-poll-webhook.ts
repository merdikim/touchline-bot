import { readFileSync } from "node:fs";

const env = loadDevVars();
const token = env.TELEGRAM_BOT_TOKEN;
const workerWebhookUrl = process.env.LOCAL_WORKER_WEBHOOK_URL ?? "http://127.0.0.1:8787/webhooks/telegram";
const dropPendingUpdates = process.env.TELEGRAM_DROP_PENDING_UPDATES === "true";

if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is missing from .dev.vars.");
}

let offset = Number(process.env.TELEGRAM_UPDATE_OFFSET ?? 0);

const bot = await telegram("getMe", {});
console.log(`Connected to Telegram as ${describeBot(bot)}`);

await telegram("deleteWebhook", { drop_pending_updates: dropPendingUpdates });
const webhookInfo = await telegram("getWebhookInfo", {});
console.log(`Webhook cleared. Current Telegram webhook URL: ${describeWebhookUrl(webhookInfo)}`);
console.log(`Polling Telegram and forwarding updates to ${workerWebhookUrl}`);
console.log("Send a new message to the bot now. In groups, mention the bot unless privacy mode is disabled.");

while (true) {
  const result = await telegram("getUpdates", {
    offset: offset || undefined,
    timeout: 25,
    allowed_updates: ["message", "my_chat_member"]
  });

  const updates = asUpdates(result);
  if (updates.length === 0) {
    console.log("No new Telegram updates yet.");
    continue;
  }

  for (const update of updates) {
    offset = update.update_id + 1;
    console.log(`Forwarding update ${update.update_id}: ${describeUpdate(update)}`);
    const response = await fetch(workerWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update)
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`Local webhook failed: ${response.status} ${body.slice(0, 300)}`);
    }
  }
}

async function telegram(method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Telegram ${method} failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json() as { ok: boolean; result: unknown; description?: string };
  if (!payload.ok) {
    throw new Error(`Telegram ${method} failed: ${payload.description ?? "unknown error"}`);
  }
  return payload.result;
}

function asUpdates(value: unknown): Array<{ update_id: number; message?: TelegramMessage; edited_message?: TelegramMessage; my_chat_member?: unknown }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is { update_id: number; message?: TelegramMessage; edited_message?: TelegramMessage; my_chat_member?: unknown } => {
    return Boolean(item) && typeof item === "object" && "update_id" in item && typeof item.update_id === "number";
  });
}

type TelegramMessage = {
  text?: string;
  chat?: { id?: number; type?: string; title?: string };
  from?: { id?: number; username?: string; first_name?: string };
};

function describeBot(value: unknown) {
  if (!value || typeof value !== "object") {
    return "unknown bot";
  }
  const bot = value as { username?: string; id?: number };
  return bot.username ? `@${bot.username} (${bot.id ?? "unknown id"})` : JSON.stringify(value);
}

function describeWebhookUrl(value: unknown) {
  if (!value || typeof value !== "object") {
    return "unknown";
  }
  const info = value as { url?: string; pending_update_count?: number; last_error_message?: string };
  const url = info.url ? info.url : "none";
  const pending = typeof info.pending_update_count === "number" ? `, pending=${info.pending_update_count}` : "";
  const error = info.last_error_message ? `, last_error=${info.last_error_message}` : "";
  return `${url}${pending}${error}`;
}

function describeUpdate(update: { message?: TelegramMessage; edited_message?: TelegramMessage; my_chat_member?: unknown }) {
  if (update.my_chat_member) {
    return "bot membership update";
  }
  const message = update.message ?? update.edited_message;
  if (!message) {
    return "non-message update";
  }
  const chat = message.chat?.title ?? message.chat?.type ?? message.chat?.id ?? "unknown chat";
  const from = message.from?.username ? `@${message.from.username}` : message.from?.first_name ?? message.from?.id ?? "unknown sender";
  const text = message.text ? `: ${message.text.slice(0, 120)}` : "";
  return `${from} in ${chat}${text}`;
}

function loadDevVars() {
  const raw = readFileSync(".dev.vars", "utf8");
  const values: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }
  return values;
}
