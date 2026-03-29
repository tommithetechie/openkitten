import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Part, TextPart } from "@opencode-ai/sdk/v2";
import { defineCommand } from "citty";
import {
  type ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  SlashCommandBuilder,
} from "discord.js";
import { discordFormatText } from "~/lib/discord-format-text";
import { discordSendText } from "~/lib/discord-send-text";
import { Dismay } from "~/lib/dismay";
import { logger } from "~/lib/logger";
import { McpServer } from "~/lib/mcp-server";
import { OpencodeConfig } from "~/lib/opencode-config";
import { OpencodeServer } from "~/lib/opencode-server";
import { Profile } from "~/lib/profile";
import { Shutdown } from "~/lib/shutdown";

const assistantWaitTimeoutMs = 120_000;
const assistantPollIntervalMs = 500;
const messageTypingHeartbeatMs = 8_000;

const modelByChoice = {
  gemini: {
    label: "Gemini",
    value: "google/gemini-2.5-flash",
  },
  phi4: {
    label: "Phi-4",
    value: "microsoft/phi-4-reasoning:free",
  },
} as const;

type ModelChoice = keyof typeof modelByChoice;

interface ActiveModel {
  readonly name: string;
  readonly model: string;
}

async function registerModelCommand(discordClient: Client): Promise<void> {
  if (!discordClient.application) {
    console.log(
      "[boot] Discord application is unavailable; skipping /model command registration",
    );
    return;
  }

  const command = new SlashCommandBuilder()
    .setName("model")
    .setDescription("Switch the active AI model")
    .addStringOption((option) =>
      option
        .setName("provider")
        .setDescription("Pick which model to use")
        .setRequired(true)
        .addChoices(
          { name: modelByChoice.gemini.label, value: "gemini" },
          { name: modelByChoice.phi4.label, value: "phi4" },
        ),
    );

  console.log("[boot] Starting /model slash command registration");

  const registration = discordClient.application.commands.set([
    command.toJSON(),
  ]);
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("Slash command registration timed out after 10s")),
      10_000,
    );
  });

  await Promise.race([registration, timeout]);
  console.log("[boot] Finished /model slash command registration");
}

async function setOpencodeModel(
  opencodeConfigDir: string,
  model: string,
): Promise<void> {
  const opencodeConfigPath = join(opencodeConfigDir, "opencode.json");
  const json = JSON.parse(
    await readFile(opencodeConfigPath, "utf-8"),
  ) as Record<string, unknown>;
  if (json["model"] === model) return;
  json["model"] = model;
  await writeFile(opencodeConfigPath, JSON.stringify(json, null, 2));
}

interface SessionMessage {
  readonly info: {
    readonly id: string;
    readonly role: string;
    readonly providerID?: string;
    readonly modelID?: string;
    readonly time: {
      readonly created: number;
      readonly completed?: number;
    };
  };
  readonly parts: readonly Part[];
}

function isCompletedAssistantMessage(message: SessionMessage): boolean {
  return (
    message.info.role === "assistant" &&
    message.info.time.completed !== undefined
  );
}

function latestAssistant(messages: readonly SessionMessage[]) {
  return messages
    .filter(isCompletedAssistantMessage)
    .sort((a, b) => b.info.time.created - a.info.time.created)[0];
}

interface AssistantReply {
  readonly text: string;
  readonly providerID: string | undefined;
  readonly modelID: string | undefined;
}

function withModelSignature({
  text,
  providerID,
  modelID,
}: AssistantReply): string {
  if (!text) return text;

  const modelRef =
    providerID && modelID
      ? `${providerID}/${modelID}`
      : (modelID ?? providerID);

  if (!modelRef) return text;
  return `${text}\n\n*(Powered by ${modelRef})*`;
}

async function waitForAssistantReply(
  sessionId: string,
  beforeMessageId: string | undefined,
  opencodeServer: OpencodeServer,
  onPoll?: () => Promise<void>,
): Promise<AssistantReply> {
  const maxAttempts = Math.ceil(
    assistantWaitTimeoutMs / assistantPollIntervalMs,
  );

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (onPoll) {
      await onPoll();
    }

    const { data: messages } = await opencodeServer.client.session.messages(
      { sessionID: sessionId, limit: 50 },
      { throwOnError: true },
    );

    const candidate = latestAssistant(messages);
    if (candidate && candidate.info.id !== beforeMessageId) {
      const text = candidate.parts
        .filter((part): part is TextPart => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      return {
        text,
        providerID: candidate.info.providerID,
        modelID: candidate.info.modelID,
      };
    }

    await Bun.sleep(assistantPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for assistant reply after ${Math.floor(assistantWaitTimeoutMs / 1000)}s`,
  );
}

function extractInteractionPrompt(
  interaction: ChatInputCommandInteraction,
): string {
  const fromPrompt = interaction.options.getString("prompt", false);
  if (fromPrompt) return fromPrompt.trim();

  const fromMessage = interaction.options.getString("message", false);
  if (fromMessage) return fromMessage.trim();

  const firstStringOption = interaction.options.data.find(
    (option) => typeof option.value === "string",
  );
  return typeof firstStringOption?.value === "string"
    ? firstStringOption.value.trim()
    : "";
}

async function sendInteractionText(
  interaction: ChatInputCommandInteraction,
  text: string,
): Promise<void> {
  const chunks = discordFormatText(text);
  if (chunks.length === 0) {
    await interaction.editReply(
      "I could not produce a text response for that prompt.",
    );
    return;
  }

  const first = chunks[0];
  await interaction.editReply({
    content: first?.markdown || first?.text || "",
    allowedMentions: { parse: [] },
  } as InteractionEditReplyOptions);

  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({
      content: chunk.markdown || chunk.text,
      allowedMentions: { parse: [] },
    } as InteractionReplyOptions);
  }
}

export const serve = defineCommand({
  meta: { description: "Start the OpenKitten Discord server." },
  run: async () => {
    const discordBotToken = Bun.env["DISCORD_BOT_TOKEN"];
    if (!discordBotToken) {
      throw new Error("Missing DISCORD_BOT_TOKEN in environment");
    }

    const profile = await Profile.create();
    const opencodeConfig = await OpencodeConfig.create(profile);
    const opencodeConfigDir = opencodeConfig.env["OPENCODE_CONFIG_DIR"];
    if (!opencodeConfigDir) {
      throw new Error("Missing OPENCODE_CONFIG_DIR in OpenCode environment");
    }

    const discordClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    using shutdown = Shutdown.create();
    console.log("[boot] Starting OpenCode server");
    await using opencodeServer = await OpencodeServer.create(opencodeConfig);
    console.log("[boot] OpenCode server is ready");
    using mcpServer = McpServer.create();
    console.log("[boot] Starting Discord client login");
    await using dismay = await Dismay.create(
      shutdown,
      discordClient,
      discordBotToken,
    );
    console.log("[boot] Discord client login complete");

    console.log("[boot] Scheduling /model slash command registration");
    void registerModelCommand(discordClient)
      .then(() => {
        console.log("[boot] /model slash command registration task completed");
      })
      .catch((error) => {
        console.error(
          "[boot] /model slash command registration failed; continuing startup",
          error,
        );
      });

    const sessionByLocation = new Map<string, string>();
    const busySessions = new Set<string>();
    let activeModel: ActiveModel = {
      name: modelByChoice.gemini.label,
      model: modelByChoice.gemini.value,
    };

    discordClient.on("messageCreate", async (message) => {
      if (message.author.bot) return;

      try {
        const prompt = message.content.trim();
        if (!prompt) return;

        const locationKey = `${message.author.id}:${message.channelId}`;
        let sessionId = sessionByLocation.get(locationKey);
        if (!sessionId) {
          const created = await opencodeServer.client.session.create(
            {},
            { throwOnError: true },
          );
          sessionId = created.data.id;
          sessionByLocation.set(locationKey, sessionId);
        }

        if (busySessions.has(sessionId)) {
          await message.reply({
            content:
              "Session is busy. Please wait for the current reply to finish.",
            allowedMentions: { parse: [] },
          });
          return;
        }

        busySessions.add(sessionId);
        try {
          await message.channel.sendTyping();
          let lastTypingAt = Date.now();

          const { data: beforeMessages } =
            await opencodeServer.client.session.messages(
              { sessionID: sessionId, limit: 50 },
              { throwOnError: true },
            );
          const beforeAssistant = latestAssistant(beforeMessages);

          await setOpencodeModel(opencodeConfigDir, activeModel.model);

          await opencodeServer.client.session.promptAsync(
            {
              sessionID: sessionId,
              parts: [{ type: "text", text: prompt }],
            },
            { throwOnError: true },
          );

          const reply = await waitForAssistantReply(
            sessionId,
            beforeAssistant?.info.id,
            opencodeServer,
            async () => {
              if (Date.now() - lastTypingAt < messageTypingHeartbeatMs) return;
              await message.channel.sendTyping();
              lastTypingAt = Date.now();
            },
          );

          if (!reply.text) {
            const { data: debugMessages } =
              await opencodeServer.client.session.messages(
                { sessionID: sessionId, limit: 10 },
                { throwOnError: true },
              );
            const debugPayload = {
              channel: "messageCreate",
              sessionId,
              beforeAssistantId: beforeAssistant?.info.id,
              prompt,
              messages: debugMessages,
            };
            console.error(
              "OpenCode returned empty text response\n",
              JSON.stringify(debugPayload, null, 2),
            );
            await message.reply({
              content: "I could not produce a text response for that prompt.",
              allowedMentions: { parse: [] },
            });
            return;
          }

          await discordSendText(message, withModelSignature(reply));
        } finally {
          busySessions.delete(sessionId);
        }
      } catch (error) {
        logger.error("Failed to process Discord message", error, {
          messageId: message.id,
          channelId: message.channelId,
          userId: message.author.id,
        });

        await message.reply({
          content:
            "I hit an error while processing your prompt. Please try again.",
          allowedMentions: { parse: [] },
        });
      }
    });

    discordClient.on("interactionCreate", async (interaction) => {
      try {
        if (!interaction.isChatInputCommand()) return;

        await interaction.deferReply();

        if (interaction.commandName === "model") {
          const selected = interaction.options.getString("provider", true);
          const choice = selected as ModelChoice;
          const next = modelByChoice[choice];
          activeModel = {
            name: next.label,
            model: next.value,
          };

          await setOpencodeModel(opencodeConfigDir, activeModel.model);
          await interaction.editReply(
            `🧠 Model switched to ${activeModel.name} (${activeModel.model})`,
          );
          return;
        }

        const prompt = extractInteractionPrompt(interaction);
        if (!prompt) {
          await interaction.editReply("Please provide a prompt.");
          return;
        }

        const locationKey = `${interaction.user.id}:interaction:${interaction.commandName}`;
        let sessionId = sessionByLocation.get(locationKey);
        if (!sessionId) {
          const created = await opencodeServer.client.session.create(
            {},
            { throwOnError: true },
          );
          sessionId = created.data.id;
          sessionByLocation.set(locationKey, sessionId);
        }

        if (busySessions.has(sessionId)) {
          await interaction.editReply(
            "Session is busy. Please wait for the current reply to finish.",
          );
          return;
        }

        busySessions.add(sessionId);
        try {
          const { data: beforeMessages } =
            await opencodeServer.client.session.messages(
              { sessionID: sessionId, limit: 50 },
              { throwOnError: true },
            );
          const beforeAssistant = latestAssistant(beforeMessages);

          await setOpencodeModel(opencodeConfigDir, activeModel.model);

          await opencodeServer.client.session.promptAsync(
            {
              sessionID: sessionId,
              parts: [{ type: "text", text: prompt }],
            },
            { throwOnError: true },
          );

          const reply = await waitForAssistantReply(
            sessionId,
            beforeAssistant?.info.id,
            opencodeServer,
          );

          if (!reply.text) {
            const { data: debugMessages } =
              await opencodeServer.client.session.messages(
                { sessionID: sessionId, limit: 10 },
                { throwOnError: true },
              );
            const debugPayload = {
              channel: "interactionCreate",
              sessionId,
              beforeAssistantId: beforeAssistant?.info.id,
              prompt,
              messages: debugMessages,
            };
            console.error(
              "OpenCode returned empty text response\n",
              JSON.stringify(debugPayload, null, 2),
            );
            await interaction.editReply(
              "I could not produce a text response for that prompt.",
            );
            return;
          }

          await sendInteractionText(interaction, withModelSignature(reply));
        } finally {
          busySessions.delete(sessionId);
        }
      } catch (error) {
        logger.error("Failed to process Discord interaction", error, {
          interactionId: interaction.id,
          userId: interaction.user.id,
          command: interaction.isChatInputCommand()
            ? interaction.commandName
            : "unknown",
        });

        const errorMessage =
          "I hit an error while processing your prompt. Please try again.";
        if (interaction.isRepliable()) {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMessage);
          } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
          }
        }
      }
    });

    logger.info("Discord bot is ready without Telegram dependencies");
    console.log("[boot] Bot startup complete; waiting for events");

    await Promise.race([
      shutdown.signaled,
      opencodeServer.exited,
      mcpServer.stopped,
      dismay.stopped,
    ]);
  },
});
