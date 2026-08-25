from urllib.parse import urlparse, quote
import httpx
from ..database import repositories as repo_db
from .encryption import decrypt_secret

API = "https://api.github.com"
API_VERSION = "2022-11-28"

def _headers(token=None):
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "GitWatcher-Discord-Bot",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers

def parse_github_profile(value: str) -> str:
    value = value.strip()
    if "://" not in value:
        value = value.lstrip("@")
        if not value or "/" in value:
            raise ValueError("Enter a GitHub username or profile URL.")
        return value
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or parsed.netloc.lower() not in ("github.com", "www.github.com"):
        raise ValueError("That is not a GitHub profile URL.")
    parts = [p for p in parsed.path.strip("/").split("/") if p]
    if len(parts) != 1:
        raise ValueError("Paste a GitHub profile URL, not a repository URL.")
    return parts[0]

def parse_repository_url(value: str):
    parsed = urlparse(value.strip())
    if parsed.scheme not in ("http", "https") or parsed.netloc.lower() not in ("github.com", "www.github.com"):
        raise ValueError("Paste a normal GitHub repository URL.")
    parts = [p for p in parsed.path.strip("/").split("/") if p]
    if len(parts) < 2:
        raise ValueError("That does not look like a GitHub repository URL.")
    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[:-4]
    return owner, repo

def guild_token(guild_id):
    credential = repo_db.get_github_credential(guild_id)
    return decrypt_secret(credential["token_encrypted"]) if credential else None

async def get_user(username, token=None):
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{API}/users/{quote(username, safe='')}", headers=_headers(token))
    if r.status_code == 404:
        raise ValueError(f"GitHub user `{username}` does not exist.")
    r.raise_for_status()
    return r.json()

async def get_authenticated_user(token):
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{API}/user", headers=_headers(token))
    if r.status_code == 401:
        raise ValueError("GitHub rejected that token.")
    r.raise_for_status()
    return r.json()

async def validate_repository(guild_id, owner, repo):
    token = guild_token(guild_id)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{API}/repos/{quote(owner, safe='')}/{quote(repo, safe='')}", headers=_headers(token))
        if r.status_code == 404:
            raise ValueError("I cannot find that repository. If it is private, run `/gitwatcher auth` first.")
        if r.status_code == 403:
            raise ValueError("GitHub denied access to that repository.")
        r.raise_for_status()
        info = r.json()
        b = await client.get(f"{API}/repos/{quote(owner, safe='')}/{quote(repo, safe='')}/branches/main", headers=_headers(token))
        if b.status_code == 404:
            raise ValueError("GitWatcher MVP only watches a branch named `main`.")
        b.raise_for_status()
        branch = b.json()
    return {
        "owner": info["owner"]["login"],
        "repo": info["name"],
        "is_private": bool(info.get("private")),
        "head_sha": branch["commit"]["sha"],
    }

async def current_main_head(repository):
    token = guild_token(repository["guild_id"])
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{API}/repos/{quote(repository['owner'], safe='')}/{quote(repository['repo'], safe='')}/branches/main",
            headers=_headers(token),
        )
    r.raise_for_status()
    return r.json()["commit"]["sha"]

async def compare_commits(repository, base_sha, head_sha):
    token = guild_token(repository["guild_id"])
    owner = quote(repository["owner"], safe="")
    repo = quote(repository["repo"], safe="")
    basehead = quote(f"{base_sha}...{head_sha}", safe=".")
    commits = []
    page = 1
    async with httpx.AsyncClient(timeout=20) as client:
        while True:
            r = await client.get(
                f"{API}/repos/{owner}/{repo}/compare/{basehead}",
                params={"per_page": 100, "page": page},
                headers=_headers(token),
            )
            if r.status_code in (404, 409):
                raise RuntimeError("Git history changed and the previous checkpoint can no longer be compared.")
            r.raise_for_status()
            payload = r.json()
            if payload.get("status") not in ("ahead", "identical"):
                raise RuntimeError("The branch history is no longer a simple continuation of the saved checkpoint.")
            batch = payload.get("commits") or []
            commits.extend(batch)
            if len(batch) < 100:
                break
            page += 1
            if page > 20:
                raise RuntimeError("Too many commits to process safely in one check.")
    return commits
