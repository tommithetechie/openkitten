import type { Message } from "discord.js";
import { discordSendText } from "~/lib/discord-send-text";

export async function discordSendSessionCompacted(
  message: Message,
): Promise<void> {
  await discordSendText(
    message,
    "📦 Session compacted (history truncated to reduce memory)",
  );
}
