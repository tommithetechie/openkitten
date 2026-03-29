import type { Message } from "discord.js";
import { discordSendError } from "~/lib/discord-send-error";
import { logger } from "~/lib/logger";
import type { Scope } from "~/lib/scope";

export function discordCreateHandler<
  THandler extends (scope: Scope, message: Message) => Promise<void>,
>(scope: Scope, handler: THandler) {
  return async (message: Message) => {
    try {
      await handler(scope, message);
    } catch (error) {
      logger.error("Discord message handler encountered an error", error, {
        userId: message.author.id,
        channelId: message.channelId,
        messageId: message.id,
      });
      try {
        await discordSendError(
          message,
          error instanceof Error ? error.message : "Unknown error",
        );
      } catch (sendError) {
        logger.fatal("Discord failed to send error message", sendError);
      }
    }
  };
}
