import { describe, it, expect } from 'vitest';
import { CIParser } from '../modules/ci-parser.js';

// ---------------------------------------------------------------------------
// extractCIStatusFromComments / extractCIStatus
// ---------------------------------------------------------------------------
describe('CIParser.extractCIStatusFromComments', () => {
  const makeComment = (login, body, created_at = '2024-01-01T00:00:00Z') => ({
    user: { login },
    body,
    created_at,
  });

  it('returns null when no comments', () => {
    expect(CIParser.extractCIStatusFromComments([])).toBeNull();
  });

  it('returns null when no flinkbot comments', () => {
    const comments = [makeComment('user1', 'some comment')];
    expect(CIParser.extractCIStatusFromComments(comments)).toBeNull();
  });

  it('returns null when flinkbot has no Azure: line', () => {
    const comments = [makeComment('flinkbot', 'Build has started')];
    expect(CIParser.extractCIStatusFromComments(comments)).toBeNull();
  });

  it('parses a SUCCESS Azure status from flinkbot comment', () => {
    const body = 'Azure: [SUCCEEDED](https://dev.azure.com/apache-flink/build/123)';
    const comments = [makeComment('flinkbot', body)];
    const result = CIParser.extractCIStatusFromComments(comments);
    expect(result).not.toBeNull();
    expect(result.status).toBe('SUCCEEDED');
    expect(result.source).toBe('azure');
    expect(result.cssClass).toBe('ci-success');
  });

  it('parses a FAILED Azure status', () => {
    const body = 'Azure: [FAILED](https://dev.azure.com/apache-flink/build/456)';
    const comments = [makeComment('flinkbot', body)];
    const result = CIParser.extractCIStatusFromComments(comments);
    expect(result.status).toBe('FAILED');
    expect(result.cssClass).toBe('ci-failure');
  });

  it('uses the most recent flinkbot comment (sorted desc by created_at)', () => {
    const older = makeComment('flinkbot', 'Azure: [FAILED](https://dev.azure.com/x/1)', '2024-01-01T00:00:00Z');
    const newer = makeComment('flinkbot', 'Azure: [SUCCEEDED](https://dev.azure.com/x/2)', '2024-01-02T00:00:00Z');
    const result = CIParser.extractCIStatusFromComments([older, newer]);
    expect(result.status).toBe('SUCCEEDED');
  });

  it('compatibility alias extractCIStatus works identically', () => {
    const body = 'Azure: [RUNNING](https://dev.azure.com/apache-flink/build/789)';
    const comments = [makeComment('flinkbot', body)];
    expect(CIParser.extractCIStatus(comments)).toEqual(
      CIParser.extractCIStatusFromComments(comments)
    );
  });
});

// ---------------------------------------------------------------------------
// parseAzureStatus
// ---------------------------------------------------------------------------
describe('CIParser.parseAzureStatus', () => {
  it('returns null for body with no Azure: match', () => {
    expect(CIParser.parseAzureStatus('No CI info here')).toBeNull();
  });

  it('returns last match when multiple Azure lines present', () => {
    const body = [
      'Azure: [FAILED](https://dev.azure.com/x/1)',
      'Azure: [SUCCEEDED](https://dev.azure.com/x/2)',
    ].join('\n');
    const result = CIParser.parseAzureStatus(body);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.url).toContain('/x/2');
  });

  it('includes cssClass and label', () => {
    const result = CIParser.parseAzureStatus('Azure: [PENDING](https://dev.azure.com/x/3)');
    expect(result.cssClass).toBe('ci-pending');
    expect(result.label).toBe('Azure: Pending');
  });
});

// ---------------------------------------------------------------------------
// parseCheckRunsStatus
// ---------------------------------------------------------------------------
describe('CIParser.parseCheckRunsStatus', () => {
  it('returns null for empty array', () => {
    expect(CIParser.parseCheckRunsStatus([])).toBeNull();
    expect(CIParser.parseCheckRunsStatus(null)).toBeNull();
  });

  it('maps completed/success to SUCCESS', () => {
    const runs = [{ name: 'Build', status: 'completed', conclusion: 'success', html_url: 'https://x' }];
    const result = CIParser.parseCheckRunsStatus(runs);
    expect(result.status).toBe('SUCCESS');
    expect(result.cssClass).toBe('ci-success');
    expect(result.source).toBe('github-actions');
  });

  it('maps completed/failure to FAILURE', () => {
    const runs = [{ name: 'CI', status: 'completed', conclusion: 'failure', html_url: '' }];
    expect(CIParser.parseCheckRunsStatus(runs).status).toBe('FAILURE');
  });

  it('maps in_progress status to IN_PROGRESS', () => {
    const runs = [{ name: 'Test', status: 'in_progress', conclusion: null, html_url: '' }];
    expect(CIParser.parseCheckRunsStatus(runs).status).toBe('IN_PROGRESS');
  });

  it('prioritizes check runs by keyword order (build > ci > test)', () => {
    const runs = [
      { name: 'lint', status: 'completed', conclusion: 'failure', html_url: '' },
      { name: 'test-suite', status: 'completed', conclusion: 'success', html_url: '' },
    ];
    // 'test' keyword matches 'test-suite' first, so success wins
    expect(CIParser.parseCheckRunsStatus(runs).status).toBe('SUCCESS');
  });

  it('falls back to first check when no keyword matches', () => {
    const runs = [
      { name: 'release-notes', status: 'completed', conclusion: 'success', html_url: '' },
      { name: 'docs', status: 'completed', conclusion: 'failure', html_url: '' },
    ];
    expect(CIParser.parseCheckRunsStatus(runs).status).toBe('SUCCESS');
  });

  it('maps cancelled conclusion to CANCELLED', () => {
    const runs = [{ name: 'build', status: 'completed', conclusion: 'cancelled', html_url: '' }];
    expect(CIParser.parseCheckRunsStatus(runs).status).toBe('CANCELLED');
  });

  it('maps queued status to QUEUED', () => {
    const runs = [{ name: 'build', status: 'queued', conclusion: null, html_url: '' }];
    expect(CIParser.parseCheckRunsStatus(runs).status).toBe('QUEUED');
  });

  it('includes checkName in result', () => {
    const runs = [{ name: 'CI Build', status: 'completed', conclusion: 'success', html_url: '' }];
    expect(CIParser.parseCheckRunsStatus(runs).checkName).toBe('CI Build');
  });
});

// ---------------------------------------------------------------------------
// parseCommitStatus
// ---------------------------------------------------------------------------
describe('CIParser.parseCommitStatus', () => {
  it('returns null for empty array', () => {
    expect(CIParser.parseCommitStatus([])).toBeNull();
    expect(CIParser.parseCommitStatus(null)).toBeNull();
  });

  it('parses success state', () => {
    const statuses = [{ state: 'success', target_url: 'https://ci.example.com', context: 'CI' }];
    const result = CIParser.parseCommitStatus(statuses);
    expect(result.status).toBe('SUCCESS');
    expect(result.cssClass).toBe('ci-success');
    expect(result.source).toBe('github-status');
  });

  it('parses failure state', () => {
    const statuses = [{ state: 'failure', target_url: '', context: 'CI' }];
    expect(CIParser.parseCommitStatus(statuses).status).toBe('FAILURE');
  });

  it('parses pending state', () => {
    const statuses = [{ state: 'pending', target_url: '', context: 'CI' }];
    expect(CIParser.parseCommitStatus(statuses).status).toBe('PENDING');
  });

  it('uses first element (most recent) from statuses array', () => {
    const statuses = [
      { state: 'success', target_url: '', context: 'CI' },
      { state: 'failure', target_url: '', context: 'CI' },
    ];
    expect(CIParser.parseCommitStatus(statuses).status).toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// mapCheckRunStatus
// ---------------------------------------------------------------------------
describe('CIParser.mapCheckRunStatus', () => {
  const cases = [
    ['completed', 'success', 'SUCCESS'],
    ['completed', 'failure', 'FAILURE'],
    ['completed', 'cancelled', 'CANCELLED'],
    ['completed', 'skipped', 'SKIPPED'],
    ['completed', 'timed_out', 'TIMEOUT'],
    ['completed', 'action_required', 'ACTION_REQUIRED'],
    ['completed', 'neutral', 'NEUTRAL'],
    ['completed', 'unknown_conclusion', 'UNKNOWN'],
    ['queued', null, 'QUEUED'],
    ['in_progress', null, 'IN_PROGRESS'],
    ['waiting', null, 'WAITING'],
    ['something_else', null, 'PENDING'],
  ];

  it.each(cases)('status=%s conclusion=%s → %s', (status, conclusion, expected) => {
    expect(CIParser.mapCheckRunStatus(status, conclusion)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// statusToCssClass
// ---------------------------------------------------------------------------
describe('CIParser.statusToCssClass', () => {
  it.each([
    ['SUCCEEDED', 'ci-success'],
    ['SUCCESS', 'ci-success'],
    ['PASSED', 'ci-success'],
    ['NEUTRAL', 'ci-success'],
    ['FAILED', 'ci-failure'],
    ['FAILURE', 'ci-failure'],
    ['ERROR', 'ci-failure'],
    ['TIMEOUT', 'ci-failure'],
    ['PENDING', 'ci-pending'],
    ['RUNNING', 'ci-pending'],
    ['IN_PROGRESS', 'ci-pending'],
    ['INPROGRESS', 'ci-pending'],
    ['QUEUED', 'ci-pending'],
    ['WAITING', 'ci-pending'],
    ['DELETED', 'ci-unknown'],
    ['CANCELED', 'ci-unknown'],
    ['CANCELLED', 'ci-unknown'],
    ['SKIPPED', 'ci-unknown'],
    ['TOTALLY_UNKNOWN', 'ci-unknown'],
  ])('%s → %s', (status, expected) => {
    expect(CIParser.statusToCssClass(status)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// statusToLabel (Azure)
// ---------------------------------------------------------------------------
describe('CIParser.statusToLabel', () => {
  it.each([
    ['SUCCEEDED', 'Azure: Pass'],
    ['SUCCESS', 'Azure: Pass'],
    ['PASSED', 'Azure: Pass'],
    ['FAILED', 'Azure: Fail'],
    ['FAILURE', 'Azure: Fail'],
    ['ERROR', 'Azure: Error'],
    ['PENDING', 'Azure: Pending'],
    ['RUNNING', 'Azure: Running'],
    ['IN_PROGRESS', 'Azure: Running'],
    ['INPROGRESS', 'Azure: Running'],
    ['DELETED', 'Azure: Deleted'],
    ['CANCELED', 'Azure: Canceled'],
    ['CANCELLED', 'Azure: Canceled'],
    ['SKIPPED', 'Azure: Skipped'],
  ])('%s → %s', (status, expected) => {
    expect(CIParser.statusToLabel(status)).toBe(expected);
  });

  it('returns "Azure: CUSTOM" for unknown status', () => {
    expect(CIParser.statusToLabel('CUSTOM')).toBe('Azure: CUSTOM');
  });
});

// ---------------------------------------------------------------------------
// statusToLabelGitHub
// ---------------------------------------------------------------------------
describe('CIParser.statusToLabelGitHub', () => {
  it('uses truncated check name (last path segment, max 12 chars)', () => {
    const label = CIParser.statusToLabelGitHub('SUCCESS', 'ci/build/very-long-name');
    // 'very-long-nam' is 13 chars, truncated to 12
    expect(label).toBe('✓ very-long-na');
  });

  it('uses "CI" when no checkName provided', () => {
    expect(CIParser.statusToLabelGitHub('SUCCESS', null)).toBe('✓ CI');
  });

  it.each([
    ['SUCCESS', '✓'],
    ['FAILURE', '✗'],
    ['ERROR', '✗'],
    ['TIMEOUT', '⏱'],
    ['PENDING', '◷'],
    ['IN_PROGRESS', '◷'],
    ['QUEUED', '◷'],
    ['WAITING', '◷'],
    ['CANCELLED', '⊘'],
    ['SKIPPED', '⊘'],
    ['NEUTRAL', '◯'],
  ])('%s starts with correct symbol', (status, symbol) => {
    expect(CIParser.statusToLabelGitHub(status, 'Build').startsWith(symbol)).toBe(true);
  });

  it('returns plain checkName for unknown status', () => {
    expect(CIParser.statusToLabelGitHub('CUSTOM_STATUS', 'Build')).toBe('Build');
  });
});
