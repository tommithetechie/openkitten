import type { Message, MessageCreateOptions } from "discord.js";
import { discordFormatText } from "~/lib/discord-format-text";
import { logger } from "~/lib/logger";

export async function discordSendText(
  message: Message,
  text: string,
): Promise<void> {
  const chunks = discordFormatText(text);

  for (const { markdown, text: plainText } of chunks) {
    const content = markdown || plainText;
    try {
      await message.reply({
        content,
        allowedMentions: { parse: [] },
      } as MessageCreateOptions);
    } catch (error) {
      logger.warn("Failed to send message chunk", error, { content });
      // If it fails to send, try with plain text
      if (markdown && markdown !== plainText) {
        try {
          await message.reply({
            content: plainText,
            allowedMentions: { parse: [] },
          } as MessageCreateOptions);
        } catch (fallbackError) {
          logger.error("Failed to send fallback text chunk", fallbackError, {
            text: plainText,
          });
          throw error;
        }
      } else {
        throw error;
      }
    }
  }
}
