import type { Client } from "discord.js";
import { logger } from "~/lib/logger";
import type { Shutdown } from "~/lib/shutdown";

export class Dismay implements AsyncDisposable {
  readonly #stopped: Promise<void>;
  readonly #dispose: () => Promise<void>;
  readonly #client: Client;

  private constructor(
    client: Client,
    stopped: Promise<void>,
    dispose: () => Promise<void>,
  ) {
    this.#client = client;
    this.#stopped = stopped;
    this.#dispose = dispose;
  }

  get client(): Client {
    return this.#client;
  }

  get stopped(): Promise<void> {
    return this.#stopped;
  }

  async [Symbol.asyncDispose]() {
    await this.#dispose();
  }

  static async create(
    shutdown: Shutdown,
    client: Client,
    botToken: string,
  ): Promise<Dismay> {
    logger.debug("Discord client is starting…");
    console.log("[boot] Dismay.create entered");

    // Fatal: errors should never reach here — all event handlers will have
    // their own error boundaries.
    client.on("error", (error) => {
      logger.fatal("Discord client caught an unhandled error", error);
      shutdown.trigger();
    });

    const { resolve, promise: started } = Promise.withResolvers<void>();
    const readyHandler = () => {
      logger.info("Discord client is ready");
      resolve();
    };

    client.once("ready", readyHandler);

    try {
      console.log("[boot] Calling discordClient.login");
      await client.login(botToken);
      console.log("[boot] discordClient.login resolved");
    } catch (error) {
      logger.fatal("Discord client failed to login", error);
      throw error;
    }

    // Wait for ready event with timeout
    const loginTimeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Discord login timeout")), 30000),
    );

    try {
      console.log("[boot] Waiting for Discord ready event");
      await Promise.race([started, loginTimeout]);
      console.log("[boot] Discord ready wait finished");
    } catch (error) {
      logger.fatal("Discord client failed to start", error);
      throw error;
    }

    // Track if we've already been disposed
    let disposed = false;
    const stopped = new Promise<void>((resolve, reject) => {
      client.once("shardDisconnect", () => {
        logger.info("Discord client is disconnected");
        if (disposed) {
          resolve();
        } else {
          reject(new Error("Discord client disconnected unexpectedly"));
        }
      });
    });

    logger.info("Discord client is ready");

    return new Dismay(client, stopped, async () => {
      disposed = true;
      try {
        await client.destroy();
      } catch (error) {
        logger.fatal("Discord client failed to destroy", error);
        shutdown.trigger();
      }
    });
  }
}
