const REPO = 'princetadhani/my-app-for-radiusctrl';
const FALLBACK_SCRIPT_URL = `https://raw.githubusercontent.com/${REPO}/main/docker/one-click-install.sh`;
const CACHE_TTL_MS = 5 * 60 * 1000;

type Release = { version: string; scriptUrl: string; fetchedAt: number };
let cache: Release | null = null;

export async function fetchLatestRelease(): Promise<{ version: string; scriptUrl: string } | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'radiusctrl-dashboard',
      },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { tag_name: string };
    const version = data.tag_name;
    const versionedUrl = `https://raw.githubusercontent.com/${REPO}/${version}/docker/one-click-install.sh`;

    // Verify the versioned script actually exists at this tag; fall back to main if not.
    const probe = await fetch(versionedUrl, { method: 'HEAD' });
    const scriptUrl = probe.ok ? versionedUrl : FALLBACK_SCRIPT_URL;

    cache = { version, scriptUrl, fetchedAt: Date.now() };
    return cache;
  } catch {
    return null;
  }
}
