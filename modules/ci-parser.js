// CI status parser for the PRism extension

class CIParser {
  static AZURE_PATTERN = /Azure:\s*\[([A-Z_]+)\]\((https?:\/\/dev\.azure\.com[^)]+)\)/gi;
  static FLINKBOT_USER = 'flinkbot';

  // Extract CI status from comments (for apache/flink main project)
  static extractCIStatusFromComments(comments) {
    // Filter flinkbot comments with Azure CI reports, sorted by created_at desc
    const flinkbotComments = comments
      .filter(c => c.user && c.user.login === this.FLINKBOT_USER)
      .filter(c => /Azure:/i.test(c.body))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (flinkbotComments.length === 0) return null;

    // Use the most recent flinkbot CI comment
    return this.parseAzureStatus(flinkbotComments[0].body);
  }

  // Compatibility method name
  static extractCIStatus(comments) {
    return this.extractCIStatusFromComments(comments);
  }

  static parseAzureStatus(body) {
    const matches = [];
    const pattern = new RegExp(this.AZURE_PATTERN.source, 'gi');
    let match;
    while ((match = pattern.exec(body)) !== null) {
      matches.push({ status: match[1].toUpperCase(), url: match[2] });
    }

    if (matches.length === 0) return null;

    // Take the last match (most recent commit status in the comment)
    const last = matches[matches.length - 1];
    return {
      status: last.status,
      url: last.url,
      cssClass: this.statusToCssClass(last.status),
      label: this.statusToLabel(last.status),
      source: 'azure',
    };
  }

  // Parse CI status from GitHub Check Runs (for flink-connector-* projects)
  static parseCheckRunsStatus(checkRuns) {
    if (!checkRuns || checkRuns.length === 0) return null;

    // Find main CI check (usually "Build" or containing "CI")
    const priorityKeywords = ['build', 'ci', 'test', 'check'];
    let mainCheck = null;

    // Prioritize checks containing keywords
    for (const keyword of priorityKeywords) {
      mainCheck = checkRuns.find(cr => 
        cr.name.toLowerCase().includes(keyword)
      );
      if (mainCheck) break;
    }

    // Use first check if none found
    if (!mainCheck) {
      mainCheck = checkRuns[0];
    }

    // Parse status
    const status = this.mapCheckRunStatus(mainCheck.status, mainCheck.conclusion);
    
    return {
      status: status,
      url: mainCheck.html_url || mainCheck.details_url || '',
      cssClass: this.statusToCssClass(status),
      label: this.statusToLabelGitHub(status, mainCheck.name),
      source: 'github-actions',
      checkName: mainCheck.name,
    };
  }

  // Parse CI status from GitHub Commit Status
  static parseCommitStatus(statuses) {
    if (!statuses || statuses.length === 0) return null;

    // Get latest status (usually the merged status)
    const latestStatus = statuses[0];
    const status = latestStatus.state.toUpperCase();

    return {
      status: status,
      url: latestStatus.target_url || '',
      cssClass: this.statusToCssClass(status),
      label: this.statusToLabelGitHub(status, latestStatus.context || 'CI'),
      source: 'github-status',
    };
  }

  // Map GitHub Check Run status
  static mapCheckRunStatus(status, conclusion) {
    if (status === 'completed') {
      switch (conclusion) {
        case 'success': return 'SUCCESS';
        case 'failure': return 'FAILURE';
        case 'cancelled': return 'CANCELLED';
        case 'skipped': return 'SKIPPED';
        case 'timed_out': return 'TIMEOUT';
        case 'action_required': return 'ACTION_REQUIRED';
        case 'neutral': return 'NEUTRAL';
        default: return 'UNKNOWN';
      }
    }
    switch (status) {
      case 'queued': return 'QUEUED';
      case 'in_progress': return 'IN_PROGRESS';
      case 'waiting': return 'WAITING';
      default: return 'PENDING';
    }
  }

  static statusToCssClass(status) {
    if (['SUCCEEDED', 'SUCCESS', 'PASSED', 'NEUTRAL'].includes(status)) return 'ci-success';
    if (['FAILED', 'FAILURE', 'ERROR', 'TIMEOUT'].includes(status)) return 'ci-failure';
    if (['PENDING', 'RUNNING', 'IN_PROGRESS', 'INPROGRESS', 'QUEUED', 'WAITING'].includes(status)) return 'ci-pending';
    if (['DELETED', 'CANCELED', 'CANCELLED', 'SKIPPED'].includes(status)) return 'ci-unknown';
    return 'ci-unknown';
  }

  static statusToLabel(status) {
    const labels = {
      SUCCEEDED: 'Azure: Pass',
      SUCCESS: 'Azure: Pass',
      PASSED: 'Azure: Pass',
      FAILED: 'Azure: Fail',
      FAILURE: 'Azure: Fail',
      ERROR: 'Azure: Error',
      PENDING: 'Azure: Pending',
      RUNNING: 'Azure: Running',
      IN_PROGRESS: 'Azure: Running',
      INPROGRESS: 'Azure: Running',
      DELETED: 'Azure: Deleted',
      CANCELED: 'Azure: Canceled',
      CANCELLED: 'Azure: Canceled',
      SKIPPED: 'Azure: Skipped',
    };
    return labels[status] || `Azure: ${status}`;
  }

  static statusToLabelGitHub(status, checkName) {
    const shortName = checkName ? checkName.split('/').pop().substring(0, 12) : 'CI';
    const labels = {
      SUCCESS: `✓ ${shortName}`,
      FAILURE: `✗ ${shortName}`,
      ERROR: `✗ ${shortName}`,
      TIMEOUT: `⏱ ${shortName}`,
      PENDING: `◷ ${shortName}`,
      IN_PROGRESS: `◷ ${shortName}`,
      QUEUED: `◷ ${shortName}`,
      WAITING: `◷ ${shortName}`,
      CANCELLED: `⊘ ${shortName}`,
      SKIPPED: `⊘ ${shortName}`,
      NEUTRAL: `◯ ${shortName}`,
    };
    return labels[status] || `${shortName}`;
  }
}

export { CIParser };