const MENTION_PATTERN = () => /<a href="tg:\/\/user\?id=[^"]*">[^<]*<\/a>/g;

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeHtmlAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

export function mention(user: { platformUserId?: string | null; displayName: string }) {
  if (!user.platformUserId) {
    return escapeHtml(user.displayName);
  }
  return `<a href="tg://user?id=${escapeHtmlAttribute(user.platformUserId)}">${escapeHtml(user.displayName)}</a>`;
}

// Telegram rejects a parse_mode=HTML message with stray "&" or "<" in it, and both the
// fixture feed and the AI rewrite can emit either. Escape everything except the mention
// anchors so the payload is always valid HTML.
export function toTelegramHtml(text: string) {
  let rendered = "";
  let index = 0;
  for (const match of text.matchAll(MENTION_PATTERN())) {
    const start = match.index ?? 0;
    rendered += escapeHtml(text.slice(index, start)) + match[0];
    index = start + match[0].length;
  }
  return rendered + escapeHtml(text.slice(index));
}

export function stripTelegramHtml(text: string) {
  return text.replace(MENTION_PATTERN(), (anchor) => unescapeHtml(anchor.replace(/^<a[^>]*>/, "").replace(/<\/a>$/, "")));
}

function unescapeHtml(value: string) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
