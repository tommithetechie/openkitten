import { join } from "node:path";
import { styleText } from "node:util";
import * as clack from "@clack/prompts";
import boxen from "boxen";
import { REST } from "discord.js";
import zod from "zod";
import { formatPath } from "~/lib/format-path";
import { isTTY } from "~/lib/is-tty";
import type { Profile } from "~/lib/profile";

const botTokenPattern =
  /^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}$/;
const botTokenError = "Bot token must be a valid Discord bot token";

const hintOptions = { symbol: styleText("cyan", "ℹ") };

const schema = zod.object({
  botToken: zod.string().regex(botTokenPattern, botTokenError),
  clientId: zod.string().regex(/^\d+$/, "Client ID must be a numeric string"),
});

function cancel(): never {
  clack.cancel("Cancelled");
  throw new DiscordConfig.CancelledError();
}

function require<T>(value: T | symbol): T {
  if (clack.isCancel(value)) cancel();
  return value;
}

async function promptBotToken(): Promise<string> {
  clack.log.message(
    "Create a bot at https://discord.com/developers/applications",
    hintOptions,
  );
  for (;;) {
    const botToken = require(
      await clack.password({
        message: "Enter your bot token",
        validate: (value) => {
          if (!value || !botTokenPattern.test(value)) return botTokenError;
          return undefined;
        },
      }),
    );
    const s = clack.spinner();
    s.start("Verifying bot token");
    try {
      const rest = new REST({ version: "10" }).setToken(botToken);
      const me = (await rest.get("/users/@me")) as {
        id: string;
        username: string;
      };
      s.stop(`Verified bot token: ${me.username}`);
      return botToken;
    } catch (e) {
      s.error("Invalid bot token, please try again");
    }
  }
}

async function promptClientId(): Promise<string> {
  clack.log.message(
    "Your Client ID is shown on the OAuth2 page at https://discord.com/developers/applications",
    hintOptions,
  );
  const clientId = require(
    await clack.text({
      message: "Enter your client ID",
      validate: (value) => {
        if (!value || !/^\d+$/.test(value))
          return "Client ID must be a numeric string";
        return undefined;
      },
    }),
  );
  return clientId;
}

export interface DiscordConfig extends zod.output<typeof schema> {}

export namespace DiscordConfig {
  export class NotFoundError extends Error {
    constructor(path: string) {
      super(`No valid Discord config found at ${formatPath(path)}`);
    }
  }

  export class CancelledError extends Error {
    constructor() {
      super("Discord config is cancelled");
    }
  }

  export async function create(profile: Profile): Promise<DiscordConfig> {
    const path = join(profile.xdgConfig, "openkitten", "discord.json");
    if (isTTY) {
      process.stderr.write(
        `${boxen(styleText("bold", "Discord"), { padding: 1 })}\n`,
      );
    }
    const file = Bun.file(path);
    if (await file.exists()) {
      const result = schema.safeParse(await file.json());
      if (result.success) {
        if (isTTY) {
          clack.intro(`Config ${styleText("dim", formatPath(path))}`);
          clack.outro("Verified config");
        }
        return result.data;
      }
    }
    if (!isTTY) throw new DiscordConfig.NotFoundError(path);
    clack.intro(`Config ${styleText("dim", formatPath(path))}`);
    const botToken = await promptBotToken();
    const clientId = await promptClientId();
    const config = schema.parse({ botToken, clientId });
    await Bun.write(path, JSON.stringify(config), { mode: 0o600 });
    clack.outro("Saved config");
    return config;
  }
}
