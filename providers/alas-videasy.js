const PROVIDER_ID = 'alas-videasy';

async function safeFetch(url, options = {}) {
  if (typeof fetchv2 === 'function') {
    const headers = options.headers || {};
    const method = options.method || 'GET';
    const body = options.body || null;
    try {
      return await fetchv2(url, headers, method, body, true, options.encoding || 'utf-8');
    } catch {
    }
  }
  return fetch(url, options);
}

function inferQualityScore(text) {
  const value = String(text || '').toLowerCase();
  if (value.includes('2160') || value.includes('4k')) return 2160;
  if (value.includes('1440')) return 1440;
  if (value.includes('1080')) return 1080;
  if (value.includes('720')) return 720;
  if (value.includes('480')) return 480;
  if (value.includes('360')) return 360;
  return 0;
}

function toQualityLabel(score) {
  if (score >= 2160) return '2160p';
  if (score >= 1440) return '1440p';
  if (score >= 1080) return '1080p';
  return 'Auto';
}

async function resolveViaVideasy(tmdbId, mediaType, seasonNum, episodeNum) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const season = Number(seasonNum || 1);
  const episode = Number(episodeNum || 1);

  const dbUrl = type === 'tv'
    ? `https://db.videasy.net/3/tv/${tmdbId}?append_to_response=external_ids&language=en&api_key=ad301b7cc82ffe19273e55e4d4206885`
    : `https://db.videasy.net/3/movie/${tmdbId}?append_to_response=external_ids&language=en&api_key=ad301b7cc82ffe19273e55e4d4206885`;

  const dbRes = await safeFetch(dbUrl);
  const dbJson = dbRes && dbRes.ok ? await dbRes.json() : null;
  if (!dbJson || !dbJson.id) return [];

  const title = type === 'tv' ? (dbJson.name || '') : (dbJson.title || '');
  const date = type === 'tv' ? dbJson.first_air_date : dbJson.release_date;
  const year = date ? new Date(date).getFullYear() : '';
  const imdbId = dbJson.external_ids && dbJson.external_ids.imdb_id ? dbJson.external_ids.imdb_id : '';

  const fullUrl = `https://api.videasy.net/cdn/sources-with-title?title=${encodeURIComponent(title)}&mediaType=${type}&year=${year}&episodeId=${type === 'tv' ? episode : 1}&seasonId=${type === 'tv' ? season : 1}&tmdbId=${dbJson.id}&imdbId=${imdbId}`;

  const encryptedRes = await safeFetch(fullUrl);
  const encryptedText = encryptedRes && encryptedRes.ok ? await encryptedRes.text() : '';
  if (!encryptedText) return [];

  const decRes = await safeFetch('https://enc-dec.app/api/dec-videasy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify({
      text: encryptedText,
      id: String(tmdbId).split('-')[0]
    })
  });

  const decJson = decRes && decRes.ok ? await decRes.json() : null;
  const result = (decJson && decJson.result) || {};
  const sources = Array.isArray(result.sources) ? result.sources : [];

  const headers = {
    Origin: 'https://player.videasy.net',
    Referer: 'https://player.videasy.net/'
  };

  return sources
    .filter(s => s && s.url && s.quality && !String(s.quality).includes('HDR'))
    .map((s) => {
      const score = Math.max(inferQualityScore(s.quality), inferQualityScore(s.url));
      return {
        name: `${PROVIDER_ID} - ${s.quality}`,
        url: s.url,
        quality: toQualityLabel(score),
        headers,
        provider: PROVIDER_ID,
        _score: score
      };
    })
    .filter(s => s._score >= 1080)
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...rest }) => rest);
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    return await resolveViaVideasy(tmdbId, mediaType, seasonNum, episodeNum);
  } catch {
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
