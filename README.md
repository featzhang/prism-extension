# PRism

A Chrome side panel extension for open source contributors to monitor Apache Flink pull requests.

![Chrome](https://img.shields.io/badge/Chrome-114+-blue?logo=googlechrome)
![Manifest](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **Side panel** — stays open while you browse, no popup that closes on click
- **PR dashboard** — live Open / Closed / Merged / Total counts
- **Author filter** — filter PRs and stats by GitHub username, defaults to logged-in user
- **Azure CI status** — parses flinkbot comments and shows CI pass/fail inline
- **Jira linking** — `[FLINK-XXXXX]` in PR titles links directly to the Jira issue
- **GitHub OAuth** — one-click login via Device Flow, no manual token setup
- **Pagination** — page indicator with total page count

## Installation

### From source

1. Clone this repo
   ```bash
   git clone https://github.com/featzhang/prism-extension.git
   ```
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the cloned folder

### From zip

Download the latest `prism.zip` from [Releases](https://github.com/featzhang/prism-extension/releases), unzip, and load unpacked as above.

## Usage

1. Click the PRism icon in the Chrome toolbar — the side panel opens on the right
2. Click **Login** to authenticate with GitHub (opens a device activation page, no password required)
3. After authorization, your username is auto-filled as the author filter
4. Use **State** / **Sort** / **Author** to filter the PR list
5. Click `[FLINK-XXXXX]` to open the Jira issue, click the title to open the PR

## Development

No build step required — plain HTML, CSS, and JS.

```
prism-extension/
├── manifest.json      # MV3 manifest
├── background.js      # Service worker: side panel, GitHub Device Flow OAuth
├── popup.html         # Side panel UI
├── popup.js           # App logic
├── popup.css          # Styles
├── options.html       # Settings page
├── options.js         # Settings logic
└── icons/             # Extension icons
```

After editing, go to `chrome://extensions/` and click the refresh icon on the PRism card.

## OAuth Setup

PRism uses GitHub OAuth Device Flow. The `client_id` is public by design — Device Flow does not require a client secret.

If you fork this project and want your own OAuth App:
1. Go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. Set **Authorization callback URL** to `http://localhost` (placeholder, not used by Device Flow)
3. Enable **Device Flow** on the app settings page
4. Replace `CLIENT_ID` in `background.js`

## License

MIT
