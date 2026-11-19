// The GitHub repository, and its star count read once at build time (no request from the browser).
export const REPO = 'typemaid/typemaid';
export const REPO_URL = `https://github.com/${REPO}`;

let stars: Promise<number | undefined> | undefined;

/** The repository's star count, or undefined when GitHub cannot be reached (offline builds, rate limits). */
export function starCount(): Promise<number | undefined> {
  stars ??= fetch(`https://api.github.com/repos/${REPO}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'typemaid-docs-build' },
    signal: AbortSignal.timeout(4000),
  })
    .then(async (res) => (res.ok ? ((await res.json()) as { stargazers_count?: unknown }).stargazers_count : undefined))
    .then((n) => (typeof n === 'number' ? n : undefined))
    .catch(() => undefined);
  return stars;
}

/** 1234 -> "1.2k". */
export const formatStars = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
