import axios from 'axios';
import { pool } from '../db/pool.js';
import { decryptSecret } from './crypto.js';

const API = 'https://api.github.com';

function headers(token) {
  const value = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'GitWatcher-Discord-Bot',
  };

  if (token) value.Authorization = `Bearer ${token}`;
  return value;
}

export function parseProfile(value) {
  const trimmed = value.trim();

  if (!trimmed.includes('://')) {
    if (!trimmed || trimmed.includes('/')) {
      throw new Error('Enter a GitHub username or profile URL.');
    }
    return trimmed.replace(/^@/, '');
  }

  const url = new URL(trimmed);

  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('That is not a GitHub profile URL.');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 1) {
    throw new Error('Paste a GitHub profile URL, not a repository URL.');
  }

  return parts[0];
}

export function parseRepo(value) {
  const url = new URL(value.trim());

  if (!['github.com', 'www.github.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('Paste a normal GitHub repository URL.');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('That does not look like a GitHub repository URL.');
  }

  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/i, ''),
  };
}

export async function guildToken(guildId) {
  const { rows } = await pool.query(
    'SELECT token_encrypted FROM github_credentials WHERE guild_id=$1',
    [guildId],
  );

  if (!rows[0]) return null;
  return decryptSecret(rows[0].token_encrypted);
}

export async function getUser(username, token = null) {
  try {
    const response = await axios.get(
      `${API}/users/${encodeURIComponent(username)}`,
      { headers: headers(token), timeout: 15000 },
    );
    return response.data;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`GitHub user "${username}" does not exist.`);
    }
    throw error;
  }
}

export async function authenticatedUser(token) {
  try {
    const response = await axios.get(`${API}/user`, {
      headers: headers(token),
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 401) {
      throw new Error('GitHub rejected that token.');
    }
    throw error;
  }
}

export async function validateRepo(guildId, owner, repo) {
  const token = await guildToken(guildId);

  try {
    const [repoResponse, branchResponse] = await Promise.all([
      axios.get(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
        headers: headers(token),
        timeout: 15000,
      }),
      axios.get(
        `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/main`,
        { headers: headers(token), timeout: 15000 },
      ),
    ]);

    return {
      owner: repoResponse.data.owner.login,
      repo: repoResponse.data.name,
      isPrivate: Boolean(repoResponse.data.private),
      headSha: branchResponse.data.commit.sha,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(
        token
          ? 'I cannot find that repo with this server’s GitHub access.'
          : 'I cannot find that repo. If it is private, run /gitwatcher auth first.',
      );
    }
    throw error;
  }
}

export async function mainHead(repository) {
  const token = await guildToken(repository.guild_id);

  const response = await axios.get(
    `${API}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/branches/main`,
    { headers: headers(token), timeout: 15000 },
  );

  return response.data.commit.sha;
}

export async function compare(repository, base, head) {
  const token = await guildToken(repository.guild_id);
  const response = await axios.get(
    `${API}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/compare/${base}...${head}`,
    {
      headers: headers(token),
      timeout: 20000,
      params: { per_page: 100 },
    },
  );

  return response.data.commits || [];
}


export async function branchHead(guildId, owner, repo, branch) {
  const token = await guildToken(guildId);

  try {
    const response = await axios.get(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`,
      {
        headers: headers(token),
        timeout: 15000,
      },
    );

    return {
      exists: true,
      sha: response.data.commit.sha,
      branch: response.data.name,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return { exists: false };
    }
    throw error;
  }
}

export async function compareBranchRange(guildId, owner, repo, base, head) {
  const token = await guildToken(guildId);

  const response = await axios.get(
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/compare/${base}...${head}`,
    {
      headers: headers(token),
      timeout: 20000,
      params: { per_page: 100 },
    },
  );

  return response.data.commits || [];
}


export async function repositoryEvents(guildId, owner, repo) {
  const token = await guildToken(guildId);

  const response = await axios.get(
    `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/events`,
    {
      headers: headers(token),
      timeout: 20000,
      params: { per_page: 100 },
    },
  );

  return response.data || [];
}
