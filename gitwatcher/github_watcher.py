
import asyncio
from urllib.parse import urlparse
import discord
import httpx
from . import db
from .config import settings
from .views import refresh_ticket_message

API = "https://api.github.com"

def parse_github_repo_url(url):
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http","https") or parsed.netloc.lower() not in ("github.com","www.github.com"):
        raise ValueError("Please provide a normal GitHub repository URL.")
    parts = [x for x in parsed.path.strip("/").split("/") if x]
    if len(parts) < 2:
        raise ValueError("That does not look like a GitHub repository URL.")
    owner, repo = parts[:2]
    if repo.endswith(".git"):
        repo = repo[:-4]
    return owner, repo

def headers():
    h = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "GitWatcher-Discord-Bot",
    }
    if settings.github_token:
        h["Authorization"] = f"Bearer {settings.github_token}"
    return h

async def fetch_commits(client, owner, repo, branch, per_page=20):
    r = await client.get(
        f"{API}/repos/{owner}/{repo}/commits",
        params={"sha": branch, "per_page": per_page},
        headers=headers(),
    )
    if r.status_code == 404:
        raise ValueError("Repository or branch not found, or the repository is private.")
    r.raise_for_status()
    return r.json()

async def validate_repository(owner, repo, branch="main"):
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{API}/repos/{owner}/{repo}", headers=headers())
        if r.status_code == 404:
            raise ValueError("Repository not found, or it is private.")
        r.raise_for_status()
        info = r.json()
        branch = branch or info.get("default_branch") or "main"
        commits = await fetch_commits(client, owner, repo, branch, 1)
        return {
            "owner": info["owner"]["login"],
            "repo": info["name"],
            "branch": branch,
            "latest_sha": commits[0]["sha"] if commits else None,
        }

def commit_github_username(commit):
    author = commit.get("author")
    return author.get("login") if isinstance(author, dict) else None

async def send_log(bot, repository, text):
    channel_id = settings.log_channel_id or repository["channel_id"]
    channel = bot.get_channel(channel_id)
    if channel is None:
        try:
            channel = await bot.fetch_channel(channel_id)
        except discord.HTTPException:
            return
    try:
        await channel.send(text)
    except discord.HTTPException:
        pass

async def process_commit(bot, repository, commit):
    message = ((commit.get("commit") or {}).get("message") or "")
    ticket = db.find_matching_ticket(repository["id"], message)
    if not ticket:
        return

    github_user = commit_github_username(commit)
    if not github_user:
        await send_log(bot, repository,
            f"⚠️ `{message.splitlines()[0]}` matches **{ticket['code']}**, "
            "but GitHub could not associate the commit with a GitHub account.")
        return

    discord_user = db.discord_for_github(github_user)
    if discord_user not in db.accepted_assignee_ids(ticket["id"]):
        await send_log(bot, repository,
            f"⚠️ `{message.splitlines()[0]}` matches **{ticket['code']}**, "
            f"but `{github_user}` is not an accepted assignee.")
        return

    db.mark_completed(ticket["id"], commit["sha"], github_user)
    await refresh_ticket_message(bot, ticket["id"])
    await send_log(bot, repository,
        f"✅ **{ticket['title']}** completed by `{github_user}` "
        f"on `{repository['owner']}/{repository['repo']}`.")

async def check_repository(bot, repository):
    async with httpx.AsyncClient(timeout=20) as client:
        commits = await fetch_commits(
            client, repository["owner"], repository["repo"],
            repository["branch"], 20
        )
    if not commits:
        return

    newest = commits[0]["sha"]
    last_seen = repository["last_seen_sha"]

    if not last_seen:
        db.set_last_seen_sha(repository["id"], newest)
        return

    unseen = []
    for commit in commits:
        if commit["sha"] == last_seen:
            break
        unseen.append(commit)

    for commit in reversed(unseen):
        await process_commit(bot, repository, commit)

    db.set_last_seen_sha(repository["id"], newest)

async def watcher_loop(bot):
    await bot.wait_until_ready()
    while not bot.is_closed():
        for repository in db.list_repositories():
            try:
                await check_repository(bot, repository)
            except Exception as exc:
                print(f"Poll failed for {repository['owner']}/{repository['repo']}: {exc}")
        await asyncio.sleep(max(settings.poll_seconds, 60))
