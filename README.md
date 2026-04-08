# PRism

A Chrome side panel extension for open source contributors to monitor Apache Flink pull requests — with real-time CI status, expert reviewer recommendations, and multi-repo aggregated views.

![Chrome](https://img.shields.io/badge/Chrome-114+-blue?logo=googlechrome)
![Manifest](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Version](https://img.shields.io/badge/Version-1.0.4-brightgreen)

## Installation

### From zip (recommended)

1. Download `prism-extension-v1.0.4.zip` from [Releases](https://github.com/featzhang/prism-extension/releases)
2. Unzip the file
3. Open `chrome://extensions/` and enable **Developer mode**
4. Click **Load unpacked** and select the unzipped folder

### From source

```bash
git clone https://github.com/featzhang/prism-extension.git
```

Then follow steps 3–4 above, selecting the cloned folder.

## Quick Start

1. Click the PRism icon in the toolbar — the side panel opens on the right
2. Click **Login** to authenticate with GitHub via Device Flow
   - A browser tab opens to `github.com/login/device`
   - Enter the 8-character code shown in the status bar and click **Authorize**
   - The panel refreshes automatically once authorized
3. Your username is auto-set as the author filter — change it or clear it to browse all authors
4. Use the **State**, **CI**, **Sort**, and **Author** dropdowns to filter the PR list; all settings are remembered across reloads
5. Select **★ All Repos** from the repository dropdown to see a merged view across all configured repos

## Features

### Dashboard & Filtering

- **PR statistics** — live Open / Closed / Merged counts; click any stat card to filter the list to that state
- **Unresolved CR count** — total unresolved review threads across the current PR list (requires login)
- **All-repos summary** — aggregated Open / Done / CR counts across all configured repositories
- **State, CI, Author, Sort filters** — all persisted across reloads; 200 ms debounce prevents redundant API calls
- **Configurable page size** — choose how many PRs to show per page

### PR List

- **CI status badges** — parsed from flinkbot comments or GitHub Actions; shown as Pass / Fail / Pending with a direct link to the build
- **CI auto-polling** — in-progress badges re-poll every 60 seconds and stop automatically when all builds resolve
- **Jira linking** — `[FLINK-XXXXX]` prefixes link directly to the Apache Jira issue
- **Unresolved CR badge** — per-PR count of unresolved review threads (requires login)
- **Repo badge** — in aggregate view, each row shows which repo the PR belongs to
- **Author link** — click a username to open their GitHub profile

### Multi-Repo Aggregated View

- **★ All Repos** — merges PRs from every configured repo into one sorted list
- **Parallel fetch** — all repos are fetched concurrently
- **Client-side pagination** — the merged pool is paginated locally; no extra API calls when changing pages

### Expert Reviewer Recommendations

- **Per-PR suggestions** — click the expert button on any PR to get reviewer recommendations based on file history
- **Batch analysis** — "Suggest Experts" analyses all visible PRs with a live progress bar
- **Scoring** — reviewers are scored and color-coded (high / medium / low confidence)
- **Copy reviewers** — one-click copy as `@user1 @user2 @user3` for PR comments
- **Rate limit circuit breaking** — skips PRs when API budget is insufficient and shows a reset countdown
- **Smart caching** — recommendations cached 24 h, file contributors cached 12 h (both in IndexedDB)
- **Cache indicator** — ⚡ badge shown when results are served from cache; refresh button to bypass

### Authentication

- **GitHub OAuth Device Flow** — one-click login; no manual token required
- **Higher rate limit** — 60 → 5,000 requests/hour after login

### Reliability

- **Offline detection** — instant banner when connectivity is lost; auto-reloads on reconnect
- **Classified error messages** — auth failures, rate limit exhaustion, network errors, and server errors each show a distinct message with an actionable hint
- **Retry button** — appears on PR load failure so you can recover without a full page reload

### Caching Strategy

| Data | TTL | Storage |
|---|---|---|
| Stats | 10 min | chrome.storage |
| PR list | 5 min | chrome.storage |
| CI / CR comments | 5 min | chrome.storage |
| File contributors | 12 h | IndexedDB |
| Expert recommendations | 24 h | IndexedDB |

## Development

No build step required — plain HTML, CSS, and ES modules.

### Project Structure

```
prism-extension/
├── manifest.json              # MV3 manifest
├── background.js              # Service worker: side panel trigger, GitHub OAuth
├── popup.html / popup.js      # Side panel entry point
├── popup.css                  # Styles
├── options.html / options.js  # Settings page
├── icons/                     # Extension icons (16, 48, 128 px)
├── modules/
│   ├── app.js                 # Main application (PRismApp class)
│   ├── config.js              # Configuration constants
│   ├── github-api.js          # GitHub API client with auth, retry, rate limit tracking
│   ├── renderer.js            # DOM rendering (stats, PR list, CI badges, pagination)
│   ├── storage.js             # chrome.storage + IndexedDB wrapper with TTL caching
│   ├── expert-recommender.js  # Expert reviewer recommendation engine
│   ├── ci-parser.js           # CI status parser (Azure CI + GitHub Actions)
│   └── utils.js               # Shared utilities
├── tests/                     # Vitest unit tests (135 tests, 99.2% coverage)
├── package.json
├── vitest.config.js
└── package.sh                 # Release zip builder
```

### Testing

```bash
npm test                # run all tests once
npm run test:watch      # watch mode
npm run test:coverage   # coverage report
```

### Building a Release

```bash
bash package.sh
# Output: dist/prism-extension-v<version>.zip
```

After editing any file, go to `chrome://extensions/` and click the refresh icon on the PRism card to reload.

## OAuth Setup

PRism uses GitHub OAuth Device Flow. The `client_id` in `background.js` is intentionally public — Device Flow requires no client secret.

To use your own OAuth App (e.g. after forking):

1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
2. Set **Authorization callback URL** to `http://localhost` (unused placeholder)
3. Enable **Device Flow** on the app settings page
4. Replace `CLIENT_ID` in `background.js` with your new client ID

## Changelog

### v1.0.4
- Fix UI flicker on load caused by double loading state toggling in `loadAll()` + `loadPRs()`

### v1.0.3
- Add CI status auto-polling for in-progress builds
- Add multi-repo aggregated PR view (★ All Repos)
- Add live progress bar for batch expert analysis

## License

MIT
