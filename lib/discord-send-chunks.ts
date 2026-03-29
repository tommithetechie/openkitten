import type { DiscordSendChunksOptions } from "~/lib/discord-send-chunks-options";
import { logger } from "~/lib/logger";

export async function discordSendChunks({
  message,
  chunks,
}: DiscordSendChunksOptions): Promise<void> {
  for (const { markdown, text } of chunks) {
    const content = markdown || text;
    try {
      await message.reply({
        content,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.warn("Failed to send message chunk", error, { content });
      // If it fails to send, try with plain text
      if (markdown && markdown !== text) {
        try {
          await message.reply({
            content: text,
            allowedMentions: { parse: [] },
          });
        } catch (fallbackError) {
          logger.error("Failed to send fallback text chunk", fallbackError, {
            text,
          });
          throw error;
        }
      } else {
        throw error;
      }
    }
  }
}
