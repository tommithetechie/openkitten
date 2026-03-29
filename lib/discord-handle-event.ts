import type { Event } from "@opencode-ai/sdk/v2";
import { discordSendError } from "~/lib/discord-send-error";
import { discordSendSessionCompacted } from "~/lib/discord-send-session-compacted";
import type { Dismay } from "~/lib/dismay";
import { logger } from "~/lib/logger";
import type { Scope } from "~/lib/scope";

export async function discordHandleEvent(
  {
    existingSessions,
    workingSessions,
    pendingPrompts,
    processingMessages,
  }: Scope,
  dismay: Dismay,
  event: Event,
  _signal: AbortSignal,
): Promise<void> {
  switch (event.type) {
    case "session.status":
      await workingSessions.update(event);
      break;
    case "question.asked":
    case "question.replied":
    case "question.rejected":
    case "permission.asked":
    case "permission.replied":
      await pendingPrompts.update(event);
      break;
    case "message.updated":
      await processingMessages.update(event);
      break;
    case "session.error": {
      const { sessionID, error } = event.properties;
      logger.error("OpenCode session encountered an error", error, {
        sessionID,
      });
      if (sessionID) {
        try {
          const location = existingSessions.get(sessionID, {
            throwIfNotFound: true,
          });
          // Convert numbers back to strings for Discord API
          const channelId = String(location.threadId);
          const userId = String(location.chatId);
          const channel = await dismay.client.channels.fetch(channelId);
          if (channel && "send" in channel) {
            const msg = await channel.send(`<@${userId}>`);
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            await discordSendError(msg, errorMessage);
          }
        } catch (sendError) {
          logger.warn("Discord failed to send error message", sendError, {
            sessionID,
          });
        }
      }
      break;
    }
    case "session.compacted": {
      const { sessionID } = event.properties;
      try {
        const location = existingSessions.get(sessionID, {
          throwIfNotFound: true,
        });
        // Convert numbers back to strings for Discord API
        const channelId = String(location.threadId);
        const userId = String(location.chatId);
        const channel = await dismay.client.channels.fetch(channelId);
        if (channel && "send" in channel) {
          const msg = await channel.send(`<@${userId}>`);
          await discordSendSessionCompacted(msg);
        }
      } catch (sendError) {
        logger.warn(
          "Discord failed to send session compacted message",
          sendError,
          {
            sessionID,
          },
        );
      }
      break;
    }
  }
}
