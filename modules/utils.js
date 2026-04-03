// Utility functions for the PRism extension

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

function getPRState(pr) {
  if (pr.merged_at) return 'merged';
  if (pr.state === 'closed') return 'closed';
  return 'open';
}

function renderPRTitle(title, prUrl) {
  // Match one or more leading [FLINK-XXXXX] tokens
  const issuePattern = /^(\[FLINK-(\d+)\])+/i;
  const match = title.match(issuePattern);

  if (!match) {
    return `<a class="pr-title pr-title-text" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(title)}</a>`;
  }

  const issueToken = match[0]; // e.g. "[FLINK-39176]"
  const rest = title.slice(issueToken.length).trimStart();

  // Extract issue number(s) — take the last one if multiple
  const issueNumbers = [];
  const re = /\[FLINK-(\d+)\]/gi;
  let m;
  while ((m = re.exec(issueToken)) !== null) issueNumbers.push(m[1]);
  const issueNum = issueNumbers[issueNumbers.length - 1];
  const issueUrl = `https://issues.apache.org/jira/browse/FLINK-${issueNum}`;

  const issueLink = `<a class="pr-title-issue" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(issueToken)}</a>`;
  const restLink = rest
    ? `<a class="pr-title pr-title-text" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(rest)}</a>`
    : `<a class="pr-title pr-title-text" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(issueToken)}</a>`;

  return `<span class="pr-title">${issueLink}${rest ? ' ' : ''}${rest ? restLink : ''}</span>`;
}

export { escapeHtml, timeAgo, getPRState, renderPRTitle };