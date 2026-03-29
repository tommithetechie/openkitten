# OpenKitten

![TypeScript](https://img.shields.io/badge/TypeScript-language-3178c6?logo=typescript&logoColor=white)
![Bun](https://img.shields.io/badge/Bun-runtime-fbf0df?logo=bun&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-100%25%20coverage-729b1b?logo=vitest&logoColor=white)
![Biome](https://img.shields.io/badge/Biome-linted%20%26%20formatted-60a5fa?logo=biome&logoColor=white)

Discord-first AI coding bot powered by OpenCode.

## Highlights

- Discord bot runtime (no Telegram boot path in the main serve flow)
- OpenCode-backed model routing
- Runtime model switch via slash command
- Automatic long-response chunking for Discord limits
- Per-reply model signature footer when provider/model metadata is available

## Current Runtime Behavior

- Listens to all non-bot messages in channels and DMs
- Ignores bot messages to avoid loops
- Sends typing indicators while waiting for model output
- Supports slash command `/model` with:
  - `Gemini` -> `google/gemini-2.5-flash`
  - `Phi-4` -> `microsoft/phi-4-reasoning:free`

## Prerequisites

- Bun runtime installed: https://bun.com/docs/installation
- A Discord bot application and token
- API key(s) for the model providers you want to use

## Install

```bash
git clone https://github.com/tommithetechie/openkitten.git
cd openkitten
bun install
```

## Environment Variables

Set these in your shell or `.env` (do not commit `.env`):

```bash
DISCORD_BOT_TOKEN=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
```

Notes:
- Gemini auth is passed to OpenCode as `GOOGLE_GENERATIVE_AI_API_KEY`.
- OpenRouter auth is also passed so `/model` can switch to Phi-4 without restart.

Optional:

```bash
OPENKITTEN_PROFILE=default
OPENKITTEN_LOG_LEVEL=info
```

## Run

Foreground run:

```bash
bun . serve
```

Typecheck:

```bash
bun typecheck
```

Lint/format check:

```bash
bun --bun biome check
```

Tests:

```bash
bun --bun vitest run
```

## How Model Switching Works

- The bot keeps an in-memory active model state (defaults to Gemini).
- `/model` updates that state at runtime.
- Before each prompt, OpenKitten updates `.opencode/opencode.json` to the selected model.
- New prompts use the selected model immediately.

## OpenCode Profile Layout

Per profile, OpenKitten initializes:

```text
~/.openkitten/profiles/<profile>/.opencode/
  opencode.json
  agents/
    assist.md
    build.md
    plan.md
```

## Security

- Keep `.env` private and untracked.
- `.env` is ignored by git in this repository.
- If secrets were ever staged, remove them from git index/history before pushing.

## Project Status

OpenKitten is under active development. Expect rapid iteration and occasional breaking changes.
