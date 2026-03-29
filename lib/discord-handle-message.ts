import type { Message } from "discord.js";
import { PendingPrompts } from "~/lib/pending-prompts";
import type { Scope } from "~/lib/scope";

export async function discordHandleMessage(
  { opencodeClient, existingSessions, workingSessions, pendingPrompts }: Scope,
  message: Message,
): Promise<void> {
  // Don't respond to own messages or bot messages
  if (message.author.bot) return;

  // Extract text from message content
  const text = message.content;
  if (!text) return;

  // Convert Discord IDs to numbers for storage
  // Discord IDs are 64-bit integers, which JavaScript can handle as numbers
  const userId = Number(message.author.id);
  const channelId = Number(message.channelId);

  // Get or create session for this user/channel combination
  const sessionId = await existingSessions.find(
    {
      chatId: userId,
      threadId: channelId,
    },
    { createIfNotFound: true },
  );

  // If the session has an active pending prompt, answer it.
  try {
    await pendingPrompts.answer({
      sessionId,
      messageId: Number(message.id),
      text,
    });
    return;
  } catch (error) {
    if (!(error instanceof PendingPrompts.NotFoundError)) throw error;
  }

  // Lock the session and send the message to OpenCode.
  await workingSessions.lock(sessionId, async () => {
    await opencodeClient.session.promptAsync(
      {
        sessionID: sessionId,
        parts: [{ type: "text", text }],
      },
      { throwOnError: true },
    );
  });
}
