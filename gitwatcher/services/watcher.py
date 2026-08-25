import asyncio
import discord
from ..config import settings
from ..database import repositories as repo_db
from ..database import tickets as ticket_db
from .github import current_main_head, compare_commits

async def _say(bot, repository, text):
    channel = bot.get_channel(repository["channel_id"])
    if channel is None:
        try:
            channel = await bot.fetch_channel(repository["channel_id"])
        except discord.HTTPException:
            return
    try:
        await channel.send(text)
    except discord.HTTPException:
        pass

async def process_commit(bot, repository, commit):
    message = ((commit.get("commit") or {}).get("message") or "")
    first_line = message.splitlines()[0] if message else ""
    normalized = ticket_db.normalize_title(first_line)
    if not normalized:
        return
    author = commit.get("author")
    if not isinstance(author, dict) or not author.get("id"):
        return
    github_user_id = int(author["id"])
    discord_user_id = repo_db.get_discord_user_for_github_id(repository["guild_id"], github_user_id)
    if not discord_user_id:
        return
    matches = ticket_db.matching_tickets(repository["id"], normalized, discord_user_id)
    if not matches:
        return
    if len(matches) > 1:
        await _say(bot, repository, f"⚠️ More than one active ticket matches `{first_line}` for <@{discord_user_id}>. I did not complete either one.")
        return
    ticket = matches[0]
    ticket_db.mark_completed(ticket["id"], commit["sha"], github_user_id, author.get("login") or "unknown")
    from ..ui.tickets import refresh_ticket_message
    await refresh_ticket_message(bot, ticket["id"])

async def check_repository(bot, repository):
    head = await current_main_head(repository)
    last = repository["last_seen_sha"]
    if not last:
        repo_db.set_last_seen_sha(repository["id"], head)
        return
    if head == last:
        return
    try:
        commits = await compare_commits(repository, last, head)
    except RuntimeError as exc:
        repo_db.set_last_seen_sha(repository["id"], head)
        await _say(bot, repository, f"⚠️ GitWatcher reset its `main` checkpoint for `{repository['owner']}/{repository['repo']}`: {exc}")
        return
    for commit in commits:
        await process_commit(bot, repository, commit)
    repo_db.set_last_seen_sha(repository["id"], head)

async def watcher_loop(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        for repository in repo_db.list_repositories():
            try:
                await check_repository(bot, repository)
            except Exception as exc:
                print(f"Watcher error for {repository['guild_id']}:{repository['owner']}/{repository['repo']}: {exc}")
        await asyncio.sleep(settings.poll_seconds)
