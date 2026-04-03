# GitHub API Rate Limit Solutions

## Problem
When using the PRism extension without authentication, you're limited to **60 API requests per hour** from GitHub's API. This can be quickly exhausted when analyzing PRs for expert recommendations.

## Solutions

### 1. Wait for Rate Limit Reset
- Rate limits reset every hour
- Current reset time: **18:31:36** (40 minutes from now)
- The extension will automatically detect when the limit resets

### 2. Use GitHub Personal Access Token (Recommended)

#### Benefits:
- **5000 requests per hour** (vs 60 without token)
- Higher rate limits for authenticated requests
- Better reliability and performance

#### How to Create a Token:

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token" → "Generate new token (classic)"
3. Set token name: `PRism Extension`
4. Set expiration: Recommended 90 days or 1 year
5. Select scopes:
   - ✅ **repo** (Full control of private repositories)
   - ✅ **read:user** (Read user profile data)
6. Click "Generate token"
7. **Copy the token immediately** - you won't see it again!

#### How to Configure in PRism:

1. Open PRism extension settings
2. Paste your token in the "GitHub Token" field
3. Save settings
4. The extension will now use your token for API requests

### 3. Optimize Extension Usage

#### Current Optimizations:
- Rate limit detection and warnings
- File analysis limited to 20 files per PR
- 200ms delay between API calls
- Smart caching to reduce duplicate requests

#### Manual Optimization Tips:
- Analyze fewer PRs at once
- Use the extension during off-peak hours
- Close and reopen the extension to clear cache

## Troubleshooting

### Token Not Working?
- Ensure the token has the correct scopes
- Check if the token has expired
- Verify the token is correctly saved in extension settings

### Still Hitting Limits?
- The extension now provides detailed rate limit information
- Wait for the next reset cycle
- Consider creating a new token with longer expiration

## Technical Details

### Rate Limit Categories:
- **Unauthenticated**: 60 requests/hour
- **Authenticated**: 5000 requests/hour
- **Search API**: 10 requests/minute (separate limit)

### Reset Times:
- Core API: Resets every hour on the hour
- Search API: Resets every minute

## Support
If you continue to experience rate limit issues, please check the extension logs for detailed error information and contact support if needed.