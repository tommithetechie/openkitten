import type { Message } from "discord.js";
import { discordSendText } from "~/lib/discord-send-text";

export async function discordSendError(
  message: Message,
  error: string,
): Promise<void> {
  await discordSendText(message, `❌ Error: ${error}`);
}
