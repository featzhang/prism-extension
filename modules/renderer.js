// Renderer for the PRism extension

import { escapeHtml, timeAgo, getPRState, renderPRTitle } from './utils.js';
import { StorageManager } from './storage.js';

class Renderer {
  constructor() {
    this.storage = new StorageManager();
  }

  renderStats(stats) {
    document.getElementById('num-open').textContent = stats.open.toLocaleString();
    document.getElementById('num-done').textContent = (stats.closed + stats.merged).toLocaleString();
  }

  renderStatsLoading() {
    ['num-open', 'num-done', 'num-unresolved-cr'].forEach(id => {
      document.getElementById(id).textContent = '…';
    });
  }

  renderPRList(prs) {
    const list = document.getElementById('pr-list');
    if (!prs || prs.length === 0) {
      list.innerHTML = '<div class="empty-state">No pull requests found.</div>';
      return;
    }

    const html = prs.map(pr => {
      const state = getPRState(pr);
      const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
      const dateField = state === 'merged' ? pr.merged_at : (state === 'closed' ? pr.closed_at : pr.created_at);
      const timeLabel = state === 'merged' ? 'Merged' : (state === 'closed' ? 'Closed' : 'Opened');

      return `
        <div class="pr-item">
          <div class="pr-item-inner">
            <div class="pr-left">
              <span class="pr-number">#${pr.number}</span>
              <span class="pr-state-badge ${escapeHtml(state)}">${escapeHtml(stateLabel)}</span>
            </div>
            <div class="pr-right">
              <div class="pr-title-row">${renderPRTitle(pr.title, pr.html_url)}</div>
            </div>
          </div>
          <div class="pr-row-bottom">
            <span class="pr-meta">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4.001 4.001 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.49 3.49 0 0 1 2 5.5z"/></svg>
              <a class="pr-author" href="https://github.com/${escapeHtml(pr.user ? pr.user.login : '')}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.user ? pr.user.login : 'unknown')}</a>
            </span>
            <span class="pr-meta" title="${new Date(dateField).toLocaleString()}">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.75.75 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0z"/></svg>
              ${escapeHtml(timeLabel)} ${escapeHtml(timeAgo(dateField))}
            </span>
            <span class="pr-meta">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
              ${pr.comments || 0}
            </span>
            <span id="ci-${pr.number}" class="ci-loading">loading CI…</span>
            <button class="expert-suggestion-btn" 
                    data-pr-number="${pr.number}"
                    title="Suggest experts for this PR">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M7.5 5.5A.5.5 0 0 1 8 5h1.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H8a.5.5 0 0 1-.5-.5v-3zm2 0a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0v-3z"/>
                <path d="M8 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
              </svg>
            </button>
            <span id="cr-${pr.number}"></span>
          </div>
          <div id="expert-results-${pr.number}" class="expert-results-row hidden"></div>
        </div>
      `;
    }).join('');

    list.innerHTML = html;
  }

  renderLoading() {
    document.getElementById('pr-list').innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading PRs…</span>
      </div>
    `;
  }

  renderError(message) {
    document.getElementById('pr-list').innerHTML = `
      <div class="error-state">
        <svg viewBox="0 0 16 16" fill="currentColor" width="32" height="32">
          <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
          <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/>
        </svg>
        <h3>Failed to Load PRs</h3>
        <p>${escapeHtml(message)}</p>
        <button id="retry-load" class="retry-btn">Retry</button>
      </div>
    `;
  }

  updateCIStatus(prNumber, ciStatus) {
    const el = document.getElementById(`ci-${prNumber}`);
    if (!el) return;

    if (!ciStatus) {
      el.className = '';
      el.innerHTML = '';
      return;
    }

    const safeLabel = escapeHtml(ciStatus.label);
    const safeUrl = escapeHtml(ciStatus.url);

    if (ciStatus.url) {
      el.outerHTML = `<a id="ci-${prNumber}" class="ci-badge ${escapeHtml(ciStatus.cssClass)} clickable"
        href="${safeUrl}" target="_blank" rel="noopener noreferrer"
        title="Azure CI: ${escapeHtml(ciStatus.status)}">${safeLabel}</a>`;
    } else {
      el.className = `ci-badge ${ciStatus.cssClass}`;
      el.textContent = ciStatus.label;
    }
  }

  updateCRCount(prNumber, count) {
    const el = document.getElementById(`cr-${prNumber}`);
    if (!el) return;
    if (count === null || count === 0) {
      el.className = '';
      el.textContent = '';
      return;
    }
    el.className = 'cr-badge';
    el.textContent = `${count} CR`;
  }

  renderCRStat(total) {
    const el = document.getElementById('num-unresolved-cr');
    if (el) el.textContent = total.toLocaleString();
  }

  async renderPagination(page, hasMore, totalCount) {
    const userPerPage = await this.storage.getUserConfig('perPage', 10);
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / userPerPage) : (hasMore ? '?' : page);
    document.getElementById('page-info').textContent = `Page ${page} / ${totalPages}`;
    document.getElementById('btn-prev').disabled = page <= 1;
    document.getElementById('btn-next').disabled = !hasMore;
  }

  showStatus(msg, isError = false) {
    const bar = document.getElementById('status-bar');
    bar.textContent = msg;
    bar.className = `status-bar${isError ? ' error' : ''}`;
  }

  hideStatus() {
    document.getElementById('status-bar').className = 'status-bar hidden';
  }
}

export { Renderer };