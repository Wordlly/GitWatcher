\
import hashlib
import hmac
import json
import re

import discord
from fastapi import FastAPI, Header, HTTPException, Request

from .config import settings
from . import db
from .views import refresh_ticket_message


app = FastAPI(title="GitWatcher V1")


@app.get("/")
async def root():
    return {"name": "GitWatcher", "status": "ok"}


@app.get("/health")
async def health():
    return {"ok": True}


def verify_signature(payload: bytes, signature: str | None):
    if not signature:
        raise HTTPException(status_code=403, detail="Missing X-Hub-Signature-256")

    digest = hmac.new(
        settings.github_webhook_secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()
    expected = f"sha256={digest}"

    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=403, detail="Invalid webhook signature")


def commit_github_username(commit: dict, payload: dict) -> str | None:
    # GitHub often includes commit.author.username for GitHub-linked commits.
    author = commit.get("author") or {}
    username = author.get("username")
    if username:
        return username

    # V1 fallback: the user who pushed the batch.
    sender = payload.get("sender") or {}
    return sender.get("login")


def authorised_for_ticket(ticket: dict, github_username: str) -> bool:
    discord_user_id = db.discord_for_github(github_username)
    if not discord_user_id:
        return False
    return discord_user_id in db.accepted_assignee_ids(ticket["id"])


async def post_log(client: discord.Client, text: str):
    if not settings.log_channel_id:
        return
    channel = client.get_channel(settings.log_channel_id)
    if channel is None:
        try:
            channel = await client.fetch_channel(settings.log_channel_id)
        except discord.HTTPException:
            return
    try:
        await channel.send(text)
    except discord.HTTPException:
        pass


def install_routes(client: discord.Client):
    @app.post("/github/webhook")
    async def github_webhook(
        request: Request,
        x_hub_signature_256: str | None = Header(default=None),
        x_github_event: str | None = Header(default=None),
    ):
        raw = await request.body()
        verify_signature(raw, x_hub_signature_256)

        if x_github_event == "ping":
            return {"ok": True, "event": "ping"}

        if x_github_event != "push":
            return {"ok": True, "ignored": f"event:{x_github_event}"}

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON")

        repo = (payload.get("repository") or {}).get("full_name", "")
        if repo.casefold() != settings.watched_repo.casefold():
            return {"ok": True, "ignored": "different repository"}

        expected_ref = f"refs/heads/{settings.watched_branch}"
        if payload.get("ref") != expected_ref:
            return {"ok": True, "ignored": "different branch"}

        completed = []

        for commit in payload.get("commits") or []:
            message = (commit.get("message") or "").splitlines()[0].strip()
            if not message:
                continue

            ticket = db.find_matching_ticket(message)
            if not ticket:
                continue

            github_username = commit_github_username(commit, payload)
            if not github_username:
                continue

            if not authorised_for_ticket(ticket, github_username):
                await post_log(
                    client,
                    f"⚠️ `{message}` matched {ticket['code']}, but GitHub user "
                    f"`{github_username}` is not an accepted assignee.",
                )
                continue

            sha = commit.get("id") or payload.get("after") or ""
            db.mark_completed(ticket["id"], sha, github_username)
            await refresh_ticket_message(client, ticket["id"])

            completed.append(ticket["code"])
            await post_log(
                client,
                f"✅ **{ticket['code']}** marked complete from `{settings.watched_branch}` "
                f"by GitHub user `{github_username}` — `{sha[:12]}`",
            )

        return {"ok": True, "completed": completed}
