export interface DiscordSendChunksOptions {
  readonly message: {
    readonly reply: (options: {
      content: string;
      allowedMentions?: { parse: string[] };
    }) => Promise<void>;
  };
  readonly chunks: readonly { text: string; markdown?: string }[];
}
