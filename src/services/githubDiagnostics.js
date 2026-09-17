export function formatGitHubRequestLog({
  label,
  authenticated,
  status,
  durationMs,
  rateRemaining,
  rateReset,
}) {
  const fields = [
    `[GitHub] ${label}`,
    `auth=${authenticated ? 'pat' : 'none'}`,
    `status=${status}`,
    `duration_ms=${durationMs}`,
  ];

  if (rateRemaining !== undefined) {
    fields.push(`rate_remaining=${rateRemaining}`);
  }

  if (rateReset !== undefined) {
    fields.push(`rate_reset=${rateReset}`);
  }

  return fields.join(' ');
}
