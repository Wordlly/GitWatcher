# GitWatcher PreGP AI chat test integration

## Goal

Add a Discord-only test path for the PreGP interviewer. `/gitwatcher ai-api` configures a per-guild provider and in-memory API key; `/gitwatcher startchat` opens a conversation in the current text channel. The copied PreGP prompts and output schemas are shared by Bedrock, OpenAI, and Claude adapters. A completed conversation produces the PreGP structured summary in the channel.

## Boundaries

- Do not edit `/Users/malcolm/CS399Dev/team-12-project`.
- Keep copied PreGP prompt/schema/shared contract code under `ai-testing/`.
- Keep GitWatcher implementation files under `src/ai-src-testing/`; integrate with existing command and message entry points without relocating existing code.
- Keep provider credentials in process memory, scoped to Discord guild ID, and discard them on process restart. Re-running the setup command overwrites the current provider/key.
- Keep transcripts in memory, scoped by guild, channel, and initiating user. Each speaker receives a separate assistant conversation in the shared channel.
- Support text only; no speech, persistent AI credentials, or transcript persistence.

## Implementation steps

1. Copy the PreGP `prompts.ts`, `schemas.ts`, and the minimal shared model/person/text/validation/AI-contract/evidence modules into `ai-testing/`, changing only local module imports and the Discord opening greeting behavior where needed.
2. Add a provider-neutral JSON generation interface with native `fetch` adapters for Bedrock Converse, OpenAI structured tool output, and Claude structured tool output. Select provider in a modal dropdown above the password-style key field. Never log submitted keys.
3. Add in-memory guild configuration and per-user/channel conversation lifecycle: Kia ora opening, collect channel messages, call the turn prompt, stop at `complete`, generate and display the cited PreGP summary, and post the same GP-only preassessment when a user stops early.
4. Integrate `/gitwatcher ai-api`, `/gitwatcher startchat`, and `/gitwatcher stopchat` plus message/modal routing. Update GitWatcher’s minimum Node version and container image to Node 22.12+ for native TypeScript stripping of copied prompt/schema files.
5. Run the project’s syntax/check workflow and inspect the final diff to ensure all source-derived files are in the allowed GitWatcher locations and no PreGP repo files changed.

## Review points

- Discord modal uses a provider select above a short secret key input.
- Missing configuration, unsupported channel types, concurrent sessions, model/API failures, and oversized Discord messages return actionable channel or ephemeral feedback without exposing secrets.
- Channel messages are visible to the channel; conversation context remains separate for each user.
