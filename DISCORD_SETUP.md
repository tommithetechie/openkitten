# Discord Integration Setup Guide

This guide explains how to set up and configure Discord support for OpenKitten.

## Overview

OpenKitten now supports both **Telegram** and **Discord** simultaneously. When configured, the bot will:
- Receive messages from Discord users
- Pass them through the OpenCode AI engine
- Send responses back to Discord channels
- Handle 2000-character message limits automatically (chunking)
- Maintain separate AI sessions per Discord user/channel combination

## Step 1: Install Dependencies

Discord support was automatically installed when you ran `bun add discord.js`. No additional action needed.

```bash
# Verify installation
bun add discord.js  # Already installed
```

## Step 2: Create a Discord Bot

### 2.1 Go to Discord Developer Portal

1. Visit [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Give it a name (e.g., "OpenKitten")
4. Accept terms and create the application

### 2.2 Create a Bot User

1. In the application settings, go to "Bot" in the left sidebar
2. Click "Add Bot"
3. Under the "TOKEN" section, click "Reset Token"
4. Copy the token (keep it secret!) - you'll need this for CONFIG

### 2.3 Set Bot Permissions

1. In the left sidebar, go to "OAuth2" → "URL Generator"
2. Under "SCOPES", select:
   - `bot`
3. Under "PERMISSIONS", select:
   - `Send Messages`
   - `Send Messages in Threads`
   - `Read Messages/View Channels`
   - `Read Message History`
   - `Mention @everyone, @here, and @[Role]`
4. Copy the generated URL and open it in your browser to add the bot to your server

### 2.4 Get Your Client ID

1. In your Discord application settings, go to "General Information"
2. Copy the "Application ID" (Client ID)

## Step 3: Configure OpenKitten for Discord

When you run OpenKitten with Discord enabled, it will prompt you for configuration:

```bash
# Start OpenKitten
bun . serve
```

### Configuration Prompts

The first time you run OpenKitten, it will ask for:

1. **Telegram Configuration** (existing):
   - Bot Token: Your Telegram bot token
   - User ID: Your Telegram user ID

2. **Discord Configuration** (new):
   - Bot Token: Paste your Discord bot token (see Step 2.2)
   - Client ID: Paste your Discord Application ID (see Step 2.4)

**Configuration Files:**

Configs are saved securely at:
- Telegram: `~/.openkitten/profiles/default/system/config/openkitten/telegram.json`
- Discord: `~/.openkitten/profiles/default/system/config/openkitten/discord.json`

To reconfigure, delete these files and restart OpenKitten.

## Step 4: Using Discord with OpenKitten

### How to Use

Once configured and running:

1. **Direct Messages**: Send a DM to your bot directly
2. **Channel Mentions**: Mention the bot in a channel: `@BotName your message here`
3. **Threads**: The bot works in threads and regular channels

### Example Usage

```
You: @OpenKitten What is TypeScript?

OpenKitten: TypeScript is a programming language built on top of JavaScript that...
          [if message is too long, automatically sent in multiple replies]
```

### Message Chunking

The Discord bot automatically breaks long responses into multiple messages (max 2000 characters per message) to match Discord's limit. This is similar to how Telegram handles the 4096-character limit.

## Step 5: Environment Variables (Optional)

You can also set environment variables instead of interactive prompts:

```bash
# Create/edit .env
export OPENKITTEN_DISCORD_BOT_TOKEN="your-bot-token"
export OPENKITTEN_DISCORD_CLIENT_ID="your-client-id"

# Start OpenKitten
bun . serve
```

## Architecture Overview

### How Discord Integration Works

```
Discord User
    ↓
    └─→ Discord Message Event
        ├─→ discordHandleMessage()
        │   ├─ Extract text
        │   ├─ Get/create session (user_id + channel_id)
        │   └─ Send to OpenCode
        │
        └─→ OpenCode AI Engine
            ├─ Process prompt
            ├─ Generate response
            └─ Emit message.updated event
                │
                └─→ discordHandleEvent()
                    └─ discordSendText()
                        ├─ Format text
                        ├─ discordFormatText()
                        │   └─ Split at 2000 chars
                        └─ Send chunks via Discord.js
```

### Key Components

#### [lib/discord-config.ts](lib/discord-config.ts)
Handles Discord configuration prompts and validation. Similar to `telegram-config.ts`.

#### [lib/dismay.ts](lib/dismay.ts)
Discord client lifecycle management (initialization, error handling, shutdown).
Named "Dismay" as a playful counterpart to "Grammy" (Telegram).

#### [lib/discord-handle-message.ts](lib/discord-handle-message.ts)
Processes incoming Discord messages and routes them to OpenCode.
- Converts Discord IDs to numbers for session storage
- Handles pending prompts and responses
- Locks sessions while processing

#### [lib/discord-format-text.ts](lib/discord-format-text.ts)
Formats and chunks text for Discord's 2000-character limit.
- Intelligently splits at sentence boundaries
- Preserves code blocks and markdown
- Falls back to plain text if markdown conversion fails

#### [lib/discord-send-text.ts](lib/discord-send-text.ts)
Sends formatted text back to Discord channels via reply.

#### [lib/discord-handle-event.ts](lib/discord-handle-event.ts)
Processes OpenCode events for Discord delivery.
- Handles errors and session compacting
- Routes responses back to Discord users

#### [lib/discord-create-handler.ts](lib/discord-create-handler.ts)
Error boundary wrapper for Discord message handlers.
Catches exceptions and sends error messages back to Discord.

## Troubleshooting

### Bot Doesn't Respond

1. **Check bot is online**: Look for the bot in your Discord server member list
2. **Verify permissions**: Ensure the bot has "Send Messages" permission in the channel
3. **Check logs**: Look at OpenKitten's log output for errors
4. **Verify token**: Re-check your Discord bot token hasn't been regenerated

### "Bot not authorized" Error

The bot token might be incorrect or expired. Get a new one:
1. Go to Discord Developer Portal
2. Select your application
3. Go to "Bot"
4. Click "Reset Token"
5. Delete `~/.openkitten/profiles/default/system/config/openkitten/discord.json`
6. Restart OpenKitten and enter the new token

### Messages Not Sending

1. Check the bot has "Send Messages" permission
2. Verify the channel/thread exists
3. Check OpenKitten has proper Discord intents enabled (already configured)

### Session Not Found

OpenKitten maintains sessions per user per channel. If you get "session not found" errors:
1. Clear the database: Delete the profile directory
2. Restart OpenKitten

## Running Telegram and Discord Simultaneously

OpenKitten now runs **both Telegram and Discord** at the same time:

```bash
bun . serve
# Both Telegram and Discord bots are active and using the same AI engine
# Each platform maintains its own sessions and user message history
```

Messages sent via Telegram and Discord are processed independently:
- Telegram user talks to the bot → separate session
- Discord user talks to the bot → separate session
- Both can have ongoing conversations with their own session history

## Advanced Configuration

### Multiple Profiles

Run multiple instances with different configurations:

```bash
# Profile 1 (default)
bun . serve

# Profile 2 (work)
OPENKITTEN_PROFILE=work bun . serve

# Each profile has its own:
# - Telegram/Discord configs
# - OpenCode configuration and agents
# - Session database
# - AI session state
```

### Session Management

Discord sessions are stored in the same database as Telegram sessions:
- `chatId`: Discord user ID (converted to number)
- `threadId`: Discord channel ID (converted to number)
- `sessionId`: OpenCode session ID

To see active sessions:

```bash
# Database is at: ~/.openkitten/profiles/default/.database.db
# Query sessions to see all active conversations
```

## File Structure

Discord integration adds these files to the codebase:

```
lib/
├── discord-config.ts           # Config loading/prompting
├── discord-chunk.ts             # Message chunk type
├── discord-create-handler.ts    # Error boundary wrapper
├── discord-format-text.ts       # Text formatting and chunking
├── discord-handle-event.ts      # OpenCode event handler
├── discord-handle-message.ts    # Message event handler
├── discord-send-chunks-options.ts # Send options type
├── discord-send-chunks.ts       # Chunk sending (unused)
├── discord-send-error.ts        # Error message sender
├── discord-send-session-compacted.ts # Session compact notification
├── discord-send-text.ts         # Main text sender
└── dismay.ts                    # Discord client lifecycle

Modified files:
├── serve.ts                     # Discord initialization
├── scope.ts                     # Discord client in scope
└── processing-messages.ts       # Discord message delivery
```

## What's Different from Telegram

| Feature | Telegram | Discord |
|---------|----------|---------|
| Message limit | 4096 characters | 2000 characters |
| Formatting | MarkdownV2 (strict) | Standard Markdown |
| Sessions | Chat ID + Thread ID | User ID + Channel ID |
| Typing indicators | Supported | Not implemented |
| Media | Supported | Text-only for now |
| Mentions | Standard | Supported |

## Future Enhancements

Potential features for future versions:

- [ ] Discord reactions for feedback
- [ ] Slash commands (`/ask`, `/help`)
- [ ] Media uploads (images, documents)
- [ ] Voice channel support
- [ ] Server-wide configuration
- [ ] User permissions per server
- [ ] Message scheduling
- [ ] Conversation history export

## Running Tests

The Discord code follows the same testing standards as the rest of OpenKitten (100% coverage target):

```bash
bun --bun vitest run  # Run tests
bun --bun vitest run --coverage  # Run with coverage report
```

## Support & Issues

If you encounter issues:

1. Check the logs: Look at OpenKitten's debug output
2. Verify configuration: Check token and Client ID are correct
3. Test connectivity: Ensure your bot can connect to Discord
4. Check permissions: Verify bot has required Discord permissions

For bug reports, include:
- OpenKitten version
- Discord bot token format (first few chars only!)
- Error message
- Steps to reproduce
- OpenKitten logs

---

**Happy coding with Discord! 🎉**
