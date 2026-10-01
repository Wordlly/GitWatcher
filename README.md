# GitWatcher V1.3

GitWatcher is a pretty straightforward github ticketing bot purpose built for teams that use Discord as their main communication channel, its meant to be light weight and doesn't get in the way of work.

The main goal was to make task tracking feel automatic and seamless. GitWatcher does this by watching repository activity, matches commits against active tickets, tracks who completed it and updates the ticket status inside Discord.

GitWatcher currently supports:

-Linking Discord users to their GitHub accounts.
-Connecting public or private GitHub repositories.
-Watching repositories and branches for commits.
-Logging commit activity into Discord channels.
-Logging newly created branches, including the branch name and creator.
-Creating manually assigned tickets.
-Creating free-for-all tickets that multiple users can accept.
-Automatically assigning temporary Discord roles based on accepted tickets.
-Matching commit messages to ticket descriptions.
-Automatically marking matching tickets as completed.
-Requiring assignees to sign off before a ticket closes.
-Testing the PreGP AI interviewer in a Discord text channel.

## PreGP AI test chat

This test integration runs the copied PreGP prompts and schemas through Amazon Bedrock, OpenAI, or Claude. A server administrator or GitWatcher Micromanager configures the provider with `/gitwatcher ai-api`; the API key is held in process memory and must be entered again after GitWatcher restarts. Running the command again replaces the current provider and key.

In the channel where you want the conversation to happen, run `/gitwatcher startchat`, then reply to PreGP’s questions as normal channel messages. Each person has a separate conversation context in that channel. `/gitwatcher stopchat` ends your chat and posts a GP-only preassessment from the answers gathered so far. The conversation and generated preassessment are visible to everyone who can read the channel. The integration does not persist the transcript or implement speech.

Optional model overrides are `GITWATCHER_AI_BEDROCK_MODEL`, `GITWATCHER_AI_OPENAI_MODEL`, and `GITWATCHER_AI_CLAUDE_MODEL`. Bedrock also uses `AWS_REGION` or `AWS_DEFAULT_REGION` (default `ap-southeast-2`).

Changelog
-Added /gitwatcher micromanager to assign a Discord role access to management commands such as /auth, /watch, /assign, and /ffa.
-Added /gitwatcher adminlog for logging rejected tasks and manually completed tickets.
-Improved multi-server isolation by enforcing guild_id checks across ticket and configuration actions.
-Added Accept / Decline controls for manually assigned tickets.
-Added reassignment flow after a declined ticket, restricted to the original delegator.
-Added ticket-role verification for protected ticket actions such as sign-off and manual closure.
-Added manual ticket completion, now displays as Manual: Ticket has been closed.
