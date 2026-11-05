function normalizedSourceHostname(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    return new URL(
      raw.includes('://')
        ? raw
        : `https://${raw}`
    )
      .hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
  } catch {
    return '';
  }
}

function googleNewsPublisherHostname(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.hostname.toLowerCase().replace(/^www\./, '') !== 'news.google.com') return '';
    const query = url.searchParams.get('q') || '';
    const match = query.match(/(?:^|\s)site:([^\s]+)/i);
    return normalizedSourceHostname(match?.[1] || '');
  } catch {
    return '';
  }
}

function rootSourceHostname(value) {
  const hostname = normalizedSourceHostname(value);
  if (!hostname) return '';
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;
  const secondToLast = parts[parts.length - 2];
  const knownSecondLevel = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac']);
  return knownSecondLevel.has(secondToLast)
    ? parts.slice(-3).join('.')
    : parts.slice(-2).join('.');
}

function sourceFetchPolicyIdentity(source) {
  const sourceObject = source && typeof source === 'object' ? source : null;
  const sourceUrl = sourceObject?.url || sourceObject?.feedUrl || String(source || '');
  let hostname = normalizedSourceHostname(sourceObject?.domain || '');

  if (!hostname || hostname === 'news.google.com') {
    hostname = googleNewsPublisherHostname(sourceUrl) || normalizedSourceHostname(sourceUrl);
  }

  return rootSourceHostname(hostname);
}

export { sourceFetchPolicyIdentity };
