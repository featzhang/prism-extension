import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { escapeHtml, timeAgo, getPRState, renderPRTitle } from '../modules/utils.js';

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
  it('escapes & to &amp;', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes < to &lt;', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes > to &gt;', () => {
    expect(escapeHtml('1 > 0')).toBe('1 &gt; 0');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('returns empty string for falsy input', () => {
    expect(escapeHtml('')).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(0)).toBe('');
  });

  it('converts non-string input via String()', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(true)).toBe('true');
  });

  it('handles all special chars in one string', () => {
    expect(escapeHtml('<a href="x" data-v=\'y\'>a & b</a>')).toBe(
      '&lt;a href=&quot;x&quot; data-v=&#39;y&#39;&gt;a &amp; b&lt;/a&gt;'
    );
  });
});

// ---------------------------------------------------------------------------
// timeAgo
// ---------------------------------------------------------------------------
describe('timeAgo', () => {
  let dateSpy;
  const BASE = 1_700_000_000_000; // fixed epoch for tests

  beforeEach(() => {
    dateSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  const ago = seconds => new Date(BASE - seconds * 1000).toISOString();

  it('returns "just now" for < 60 seconds', () => {
    expect(timeAgo(ago(30))).toBe('just now');
    expect(timeAgo(ago(0))).toBe('just now');
  });

  it('returns Xm ago for < 1 hour', () => {
    expect(timeAgo(ago(60))).toBe('1m ago');
    expect(timeAgo(ago(90))).toBe('1m ago');
    expect(timeAgo(ago(3599))).toBe('59m ago');
  });

  it('returns Xh ago for < 1 day', () => {
    expect(timeAgo(ago(3600))).toBe('1h ago');
    expect(timeAgo(ago(7200))).toBe('2h ago');
    expect(timeAgo(ago(86399))).toBe('23h ago');
  });

  it('returns Xd ago for < 30 days', () => {
    expect(timeAgo(ago(86400))).toBe('1d ago');
    expect(timeAgo(ago(86400 * 7))).toBe('7d ago');
    expect(timeAgo(ago(86400 * 29))).toBe('29d ago');
  });

  it('returns Xmo ago for < 365 days', () => {
    expect(timeAgo(ago(86400 * 30))).toBe('1mo ago');
    expect(timeAgo(ago(86400 * 60))).toBe('2mo ago');
  });

  it('returns Xy ago for >= 365 days', () => {
    expect(timeAgo(ago(86400 * 365))).toBe('1y ago');
    expect(timeAgo(ago(86400 * 730))).toBe('2y ago');
  });
});

// ---------------------------------------------------------------------------
// getPRState
// ---------------------------------------------------------------------------
describe('getPRState', () => {
  it('returns "merged" when merged_at is set', () => {
    expect(getPRState({ merged_at: '2024-01-01T00:00:00Z', state: 'closed' })).toBe('merged');
  });

  it('returns "closed" when state is closed and not merged', () => {
    expect(getPRState({ merged_at: null, state: 'closed' })).toBe('closed');
    expect(getPRState({ state: 'closed' })).toBe('closed');
  });

  it('returns "open" for all other cases', () => {
    expect(getPRState({ state: 'open' })).toBe('open');
    expect(getPRState({ state: 'open', merged_at: null })).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// renderPRTitle
// ---------------------------------------------------------------------------
describe('renderPRTitle', () => {
  const url = 'https://github.com/apache/flink/pull/1';

  it('renders plain title without FLINK prefix as single link', () => {
    const html = renderPRTitle('Some improvement', url);
    expect(html).toContain('class="pr-title pr-title-text"');
    expect(html).toContain('href="https://github.com/apache/flink/pull/1"');
    expect(html).toContain('Some improvement');
    expect(html).not.toContain('pr-title-issue');
  });

  it('renders single [FLINK-XXXXX] prefix as issue link + rest link', () => {
    const html = renderPRTitle('[FLINK-12345] Fix the bug', url);
    expect(html).toContain('class="pr-title-issue"');
    expect(html).toContain('href="https://issues.apache.org/jira/browse/FLINK-12345"');
    expect(html).toContain('[FLINK-12345]');
    expect(html).toContain('Fix the bug');
  });

  it('uses the last issue number when multiple [FLINK-XXXXX] tokens appear', () => {
    const html = renderPRTitle('[FLINK-100][FLINK-200] Combined fix', url);
    // issue link should point to FLINK-200 (last)
    expect(html).toContain('FLINK-200');
    expect(html).toContain('Combined fix');
  });

  it('escapes HTML special chars in title and URL', () => {
    const html = renderPRTitle('Fix <script> & "quotes"', url);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;quotes&quot;');
  });

  it('escapes special chars in URL', () => {
    const dangerUrl = 'https://github.com/x/y?a=1&b=2';
    const html = renderPRTitle('Title', dangerUrl);
    expect(html).not.toContain('"https://github.com/x/y?a=1&b=2"');
    expect(html).toContain('&amp;');
  });

  it('handles title that is only the FLINK token (no rest text)', () => {
    const html = renderPRTitle('[FLINK-99999]', url);
    // When rest is empty the fallback link uses the full issueToken
    expect(html).toContain('[FLINK-99999]');
  });
});
