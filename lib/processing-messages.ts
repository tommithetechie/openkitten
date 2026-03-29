import type {
  AssistantMessage,
  EventMessageUpdated,
  Part,
  TextPart,
} from "@opencode-ai/sdk/v2";
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { Client } from "discord.js";
import { eq } from "drizzle-orm";
import type { Bot } from "grammy";
import type { Database } from "~/lib/database";
import { discordSendText } from "~/lib/discord-send-text";
import type { Dismay } from "~/lib/dismay";
import { Errors } from "~/lib/errors";
import type { ExistingSessions } from "~/lib/existing-sessions";
import { grammySendText } from "~/lib/grammy-send-text";
import { logger } from "~/lib/logger";
import * as schema from "~/lib/schema";

export class ProcessingMessages {
  readonly #bot: Bot;
  readonly #discordClient: Client | undefined;
  readonly #dismay: Dismay | undefined;
  readonly #database: Database;
  readonly #opencodeClient: OpencodeClient;
  readonly #existingSessions: ExistingSessions;

  private constructor(
    bot: Bot,
    database: Database,
    opencodeClient: OpencodeClient,
    existingSessions: ExistingSessions,
    discordClient?: Client | null,
    dismay?: Dismay | null,
  ) {
    this.#bot = bot;
    this.#discordClient = discordClient ?? undefined;
    this.#dismay = dismay ?? undefined;
    this.#database = database;
    this.#opencodeClient = opencodeClient;
    this.#existingSessions = existingSessions;
  }

  // Insert-or-ignore: returns true if we claimed the message first,
  // false if it was already claimed (e.g. by a previous invalidation or update).
  #claim(message: AssistantMessage): boolean {
    const rows = this.#database
      .insert(schema.message)
      .values({
        id: message.id,
        sessionId: message.sessionID,
        createdAt: new Date(message.time.created),
      })
      .onConflictDoNothing()
      .returning({ id: schema.message.id })
      .all();
    return rows.length > 0;
  }

  #unclaim(message: AssistantMessage): void {
    this.#database
      .delete(schema.message)
      .where(eq(schema.message.id, message.id))
      .run();
  }

  async #deliver(
    message: AssistantMessage,
    parts: readonly Part[],
  ): Promise<void> {
    const text = parts
      .filter((part): part is TextPart => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (!text) return;
    const { chatId, threadId } = this.#existingSessions.get(message.sessionID, {
      throwIfNotFound: true,
    });

    // Try Discord first if available and discord client exists
    if (this.#discordClient && this.#dismay && threadId) {
      try {
        // threadId is stored as a number in the database, convert it to string for Discord API
        const channelId = String(threadId);
        const userId = String(chatId);
        const channel = await this.#discordClient.channels.fetch(channelId);
        if (channel && "send" in channel) {
          const msg = await channel.send(`<@${userId}>`);
          await discordSendText(msg, text);
          return;
        }
      } catch (error) {
        logger.debug(
          "Failed to send to Discord, falling back to Telegram",
          error,
          {
            channelId: threadId,
            userId: chatId,
          },
        );
      }
    }

    // Fall back to Telegram
    await grammySendText({ bot: this.#bot, text, chatId, threadId });
  }

  // Fetch messages with an expanding window until we overlap with
  // already-delivered messages or exhaust the history.
  async #invalidate(sessionId: string): Promise<void> {
    let limit = 10;
    let batch: { info: AssistantMessage; parts: Part[] }[] = [];
    for (;;) {
      const { data: messages } = await this.#opencodeClient.session.messages(
        { sessionID: sessionId, limit },
        { throwOnError: true },
      );
      batch = messages.filter(
        (m): m is { info: AssistantMessage; parts: Part[] } =>
          m.info.role === "assistant" && m.info.time.completed !== undefined,
      );
      if (messages.length < limit) break;
      const oldest = batch[0];
      if (oldest) {
        const overlap = !!this.#database.query.message
          .findFirst({
            columns: { id: true },
            where: eq(schema.message.id, oldest.info.id),
          })
          .sync();
        if (overlap) break;
      }
      limit *= 2;
    }
    for (const { info, parts } of batch) {
      if (!this.#claim(info)) continue;
      try {
        await this.#deliver(info, parts);
      } catch (error) {
        this.#unclaim(info);
        throw error;
      }
    }
  }

  async update(event: EventMessageUpdated) {
    const { info } = event.properties;
    if (info.role !== "assistant" || info.time.completed === undefined) return;
    if (!this.#claim(info)) return;
    try {
      const { data } = await this.#opencodeClient.session.message(
        { sessionID: info.sessionID, messageID: info.id },
        { throwOnError: true },
      );
      await this.#deliver(info, data.parts);
    } catch (error) {
      this.#unclaim(info);
      throw error;
    }
  }

  async invalidate() {
    const { sessionIds } = this.#existingSessions;
    if (sessionIds.length === 0) return;
    const results = await Promise.allSettled(
      sessionIds.map((sessionId) => this.#invalidate(sessionId)),
    );
    Errors.throwIfAny(results);
  }

  static create(
    bot: Bot,
    database: Database,
    opencodeClient: OpencodeClient,
    existingSessions: ExistingSessions,
    discordClient?: Client | null,
    dismay?: Dismay | null,
  ): ProcessingMessages {
    return new ProcessingMessages(
      bot,
      database,
      opencodeClient,
      existingSessions,
      discordClient,
      dismay,
    );
  }
}
