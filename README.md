# PRism

A Chrome side panel extension for open source contributors to monitor Apache Flink pull requests.

![Chrome](https://img.shields.io/badge/Chrome-114+-blue?logo=googlechrome)
![Manifest](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Version](https://img.shields.io/badge/Version-1.0.3-brightgreen)

## Features

### Dashboard
- **PR statistics** — live Open / Closed / Merged / Total counts for the selected repository
- **Unresolved CR count** — total number of unresolved review threads across the current PR list (requires login)
- **Click to filter** — click any stat card to switch the PR list to that state
- **All-repos summary** — aggregated Open / Done / CR counts across all configured repositories

### PR List
- **State filter** — filter by Open, Closed, or All; state persisted across reloads
- **CI filter** — filter by CI result: Pass, Fail, Pending, or Unknown (auto-detects Azure CI or GitHub Actions); filter persisted across reloads
- **Author filter** — filter PRs and stats by GitHub username; defaults to the logged-in user
- **Sort** — sort by Newest, Oldest, Recently updated, or Least updated; sort persisted across reloads
- **Page size** — configurable items per page
- **Pagination** — navigate pages with ← → arrows and total page count displayed
- **Jira linking** — `[FLINK-XXXXX]` prefixes in PR titles link directly to the Apache Jira issue
- **PR title link** — click the title text to open the PR on GitHub
- **Author link** — click the author username to open their GitHub profile
- **CI status** — parsed from flinkbot comments or GitHub Actions, shown inline as Pass / Fail / Pending badge with a direct link to the build
- **CI auto-polling** — in-progress CI badges automatically re-poll every 60 seconds; polling stops when all PRs resolve
- **Repo badge** — in aggregate view, each PR row shows which repo it belongs to
- **Unresolved CR badge** — per-PR count of unresolved review threads (requires login)

### Multi-Repo Aggregated View
- **★ All Repos** — select "All Repos" in the repository dropdown to see PRs from all configured repos in one merged list
- **Parallel fetch** — PRs are fetched from every repo concurrently and merged into a single sorted pool
- **Client-side pagination** — the merged pool is paginated locally; no extra API calls when changing pages
- **Unified sort** — the merged pool is re-sorted by the current sort setting (Newest / Oldest / Recently updated / Least updated)

### Expert Reviewer Recommendations
- **Per-PR analysis** — click the expert button on any PR to get reviewer suggestions based on file history and contributors
- **Batch analysis** — "Suggest Experts" analyses all visible PRs with a live progress bar showing `X / N PRs analyzed`
- **Scoring system** — each recommended reviewer is scored and color-coded (high / medium / low)
- **Copy reviewers** — one-click copy all recommended reviewers as `@user1 @user2 @user3` for PR comments
- **Rate limit circuit breaking** — predictive quota check before each analysis; skips PRs when API budget is insufficient and shows a reset countdown
- **Smart caching** — expert recommendations cached for 24 hours (IndexedDB), file contributors cached for 12 hours (IndexedDB)
- **Cache indicator** — ⚡ Cached badge shown when results are served from cache
- **Refresh button** — bypass cache and re-fetch fresh recommendations on demand

### Authentication
- **GitHub OAuth login** — one-click login via Device Flow; no manual token or password required
- **Authenticated API access** — rate limit raised from 60 to 5,000 requests/hour after login
- **Auto-fill author** — logged-in username is automatically set as the default author filter

### Offline Detection
- **Instant offline banner** — a blue info banner appears immediately when network connectivity is lost, with refresh buttons disabled
- **Auto-reload on reconnect** — when connectivity is restored, the banner clears and data reloads automatically
- **Offline guard** — manual refresh and filter changes do nothing while offline, preventing misleading API errors

### Error Handling
- **Classified errors** — auth failures, rate limit exhaustion, network errors, and server errors each show a distinct message with an actionable hint
- **Rate limit hint** — shows how many minutes until the quota resets, with a live per-minute countdown in the Expert panel
- **Retry button** — a Retry button appears on PR load failure so users can recover without a full page reload

### General
- **Side panel** — lives in the browser sidebar; stays open while you navigate between tabs
- **Multi-repo support** — switch between preset Apache Flink repositories or add custom repos in settings; includes an aggregate "All Repos" view
- **Settings** — configure the target repository (`owner/repo` format) and custom repo list via the settings page
- **Smart cache** — tiered caching strategy with IndexedDB for large payloads:
  - Stats: 10 minutes (chrome.storage)
  - PR list: 5 minutes (chrome.storage)
  - CI / CR comments: 5 minutes (chrome.storage)
  - File contributors: 12 hours (**IndexedDB**)
  - Expert recommendations: 24 hours (**IndexedDB**)
- **API request counter** — real-time display of GitHub API calls made, with rate limit status tooltip
- **Filter debounce** — 200 ms debounce on state and sort filter changes to prevent redundant API calls

## Installation

### From zip (recommended)

1. Download the latest `prism-extension-v*.zip` from [Releases](https://github.com/featzhang/prism-extension/releases)
2. Unzip the file
3. Open `chrome://extensions/`
4. Enable **Developer mode** (toggle in the top right)
5. Click **Load unpacked** and select the unzipped folder

### From source

```bash
git clone https://github.com/featzhang/prism-extension.git
```

Then follow steps 3–5 above, selecting the cloned folder.

## Usage

1. Click the PRism icon in the Chrome toolbar — the side panel opens on the right
2. Click **Login** to authenticate with GitHub
   - A browser tab opens to `github.com/login/device`
   - Enter the 8-character code shown in the status bar
   - Click **Authorize** on GitHub
   - The panel refreshes automatically once authorized
3. Your GitHub username is auto-filled as the author filter
4. Use **State**, **CI**, **Author**, and **Sort** to filter and sort the PR list (settings are remembered across reloads)
5. Select **★ All Repos** from the repository dropdown to see a merged view of all repos
6. Click `[FLINK-XXXXX]` in a PR title to open the Jira issue; click the rest of the title to open the PR
7. Click an author name to open their GitHub profile
8. Click a stat card in the dashboard to switch the list to that state
9. Click the 👤 expert button on a PR to get reviewer recommendations
10. Click **Suggest Experts** to analyse all visible PRs; watch the progress bar as results stream in
11. Click the refresh icon to clear all caches and reload

## Development

No build step required — plain HTML, CSS, and ES modules.

### Project Structure

```
prism-extension/
├── manifest.json              # MV3 manifest
├── background.js              # Service worker: side panel trigger, GitHub Device Flow OAuth
├── popup.html                 # Side panel UI
├── popup.js                   # Entry point, imports PRismApp
├── popup.css                  # Styles
├── options.html               # Settings page UI
├── options.js                 # Settings logic
├── icons/                     # Extension icons (16, 48, 128px)
├── modules/
│   ├── app.js                 # Main application (PRismApp class)
│   ├── config.js              # Configuration constants (repos, TTLs, API URLs)
│   ├── github-api.js          # GitHub API client with auth, retry, rate limit tracking
│   ├── renderer.js            # DOM rendering (stats, PR list, pagination, CI badges)
│   ├── storage.js             # Chrome storage + IndexedDB wrapper with TTL-based caching
│   ├── expert-recommender.js  # Expert reviewer recommendation engine
│   ├── ci-parser.js           # CI status parser (Azure CI + GitHub Actions)
│   └── utils.js               # Shared utility functions
├── tests/                     # Vitest unit tests (utils, ci-parser, storage)
├── package.json               # Dev dependencies (Vitest)
├── vitest.config.js           # Test configuration
├── package.sh                 # Build script for release zip
└── README.md
```

### Testing

```bash
npm test               # run all tests once
npm run test:watch     # watch mode
npm run test:coverage  # coverage report
```

135 tests across `utils.js`, `ci-parser.js`, and `storage.js` — 99.2% statement coverage.

### Building

```bash
bash package.sh
# Output: dist/prism-extension-v<version>.zip
```

After editing any file, go to `chrome://extensions/` and click the refresh icon on the PRism card to reload.

## OAuth Setup

PRism uses GitHub OAuth Device Flow. The `client_id` is intentionally public — Device Flow does not use a client secret, so there is nothing sensitive to protect.

To use your own OAuth App (e.g. after forking):

1. Go to GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
2. Fill in any name and homepage URL
3. Set **Authorization callback URL** to `http://localhost` (unused placeholder)
4. Save, then open the app settings and enable **Device Flow**
5. Replace `CLIENT_ID` in `background.js` with your new client ID

## License

MIT
