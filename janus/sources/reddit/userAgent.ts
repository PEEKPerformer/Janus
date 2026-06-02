/**
 * Randomized iOS Safari User-Agent, generated once per app session.
 *
 * Lifted from Hydra (api/UserAgent.ts). Reddit's .json web endpoints are
 * friendlier to a browser-like UA; a randomized version avoids a static
 * fingerprint. Note (per the Phase-0 review): this is weak evasion, not a
 * substitute for the rate-limiting/backoff the transport adds.
 */
export function generateUserAgent(): string {
  const iosVersion = Math.floor(Math.random() * 5) + 9;
  const safariVersion = Math.floor(Math.random() * 5) + 600;
  const webkitVersion = Math.floor(Math.random() * 700) + 500;
  const minor = Math.floor(Math.random() * 10);
  const platform =
    `CPU iPhone OS ${iosVersion}_${minor} like Mac OS X) ` +
    `AppleWebKit/${webkitVersion}.60 (KHTML, like Gecko) ` +
    `Version/${safariVersion}.0 Mobile/15E148 Safari/${webkitVersion}.60`;
  return `Mozilla/5.0 (${platform}`;
}

export const REDDIT_USER_AGENT = generateUserAgent();
