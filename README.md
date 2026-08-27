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

Changelog
-Added /gitwatcher micromanager to assign a trusted Discord role access to management commands such as /auth, /watch, /assign, and /ffa.
-Added /gitwatcher adminlog for logging rejected tasks and manually completed tickets.
-Improved multi-server isolation by enforcing guild_id checks across ticket and configuration actions.
-Added Accept / Decline controls for manually assigned tickets.
-Added reassignment flow after a declined ticket, restricted to the original delegator.
-Added ticket-role verification for protected ticket actions such as sign-off and manual closure.
-Added manual ticket completion, now displays as Manual: Ticket has been closed.
-Rejections and manual completions are now stored in PostgreSQL for future reporting.