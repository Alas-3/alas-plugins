const PROVIDER_ID = 'alas-sunduq';

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

function maxResolutionFromM3u8Text(text) {
  const input = String(text || '');
  let maxY = 0;
  const re = /RESOLUTION=\s*\d+\s*x\s*(\d+)/gi;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(input)) !== null) {
    const y = Number(m[1]);
    if (Number.isFinite(y) && y > maxY) maxY = y;
  }
  return maxY;
}

async function detectPlaylistMaxQuality(playlistUrl, headers) {
  try {
    const res = await safeFetch(playlistUrl, { headers: headers || {} });
    const text = res && res.ok ? await res.text() : '';
    const maxY = maxResolutionFromM3u8Text(text);
    return maxY || 0;
  } catch {
    return 0;
  }
}

function buildContentId(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === 'tv') {
    return `tv/${tmdbId}/${Number(seasonNum || 1)}/${Number(episodeNum || 1)}`;
  }
  return `movie/${tmdbId}`;
}

async function fetchVidlink(contentId) {
  try {
    const parts = contentId.split('/');
    const tmdbId = parts[1];
    const encRes = await safeFetch(`https://enc-dec.app/api/enc-vidlink?text=${encodeURIComponent(tmdbId)}`);
    const encJson = encRes && encRes.ok ? await encRes.json() : null;
    const encodedId = encJson && encJson.result;
    if (!encodedId) return null;

    const apiUrl = contentId.startsWith('movie/')
      ? `https://vidlink.pro/api/b/movie/${encodedId}?multiLang=0`
      : `https://vidlink.pro/api/b/tv/${encodedId}/${parts[2]}/${parts[3]}?multiLang=0`;

    const res = await safeFetch(apiUrl);
    const data = res && res.ok ? await res.json() : null;
    const playlist = data && data.stream && data.stream.playlist;
    if (!playlist) return null;

    const headers = {
      Referer: 'https://vidlink.pro/',
      Origin: 'https://vidlink.pro'
    };

    const scoreFromUrl = inferQualityScore(playlist);
    const maxFromPlaylist = await detectPlaylistMaxQuality(playlist, headers);
    const score = Math.max(scoreFromUrl, maxFromPlaylist);
    if (score < 1080) return null;

    return {
      name: `${PROVIDER_ID} - Vidlink`,
      url: playlist,
      quality: toQualityLabel(score),
      headers,
      provider: PROVIDER_ID,
      _score: score
    };
  } catch {
    return null;
  }
}

async function fetchVixSrc(contentId) {
  try {
    const baseUrl = `https://vixsrc.to/${contentId}`;
    const res = await safeFetch(baseUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = res && res.ok ? await res.text() : '';
    if (!html) return null;

    let streamUrl = '';

    // Prefer tokenized master playlist if present
    if (html.includes('window.masterPlaylist')) {
      const urlMatch = html.match(/url:\s*['"]([^'"]+)['"]/);
      const tokenMatch = html.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
      const expiresMatch = html.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);
      if (urlMatch && tokenMatch && expiresMatch) {
        const base = urlMatch[1];
        const token = tokenMatch[1];
        const expires = expiresMatch[1];
        streamUrl = base.includes('?b=1')
          ? `${base}&token=${token}&expires=${expires}&h=1&lang=en`
          : `${base}?token=${token}&expires=${expires}&h=1&lang=en`;
      }
    }

    if (!streamUrl) {
      const m3u8Match = html.match(/(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/);
      if (m3u8Match) streamUrl = m3u8Match[1];
    }

    if (!streamUrl) return null;

    const headers = { Referer: 'https://vixsrc.to/' };
    const scoreFromUrl = inferQualityScore(streamUrl);
    const maxFromPlaylist = await detectPlaylistMaxQuality(streamUrl, headers);
    const score = Math.max(scoreFromUrl, maxFromPlaylist);
    if (score < 1080) return null;

    return {
      name: `${PROVIDER_ID} - VixSrc`,
      url: streamUrl,
      quality: toQualityLabel(score),
      headers,
      provider: PROVIDER_ID,
      _score: score
    };
  } catch {
    return null;
  }
}

async function fetchWyzieSubtitle(contentId) {
  try {
    if (contentId.startsWith('movie/')) {
      const tmdbId = contentId.split('/')[1];
      const res = await safeFetch(`https://sub.wyzie.ru/search?id=${tmdbId}`);
      const data = res && res.ok ? await res.json() : [];
      const track = Array.isArray(data)
        ? data.find(t => (t.display || '').includes('English') && t.url) || null
        : null;
      return track ? track.url : '';
    }

    if (contentId.startsWith('tv/')) {
      const parts = contentId.split('/');
      const tmdbId = parts[1];
      const season = parts[2];
      const episode = parts[3];
      const res = await safeFetch(`https://sub.wyzie.ru/search?id=${tmdbId}&season=${season}&episode=${episode}`);
      const data = res && res.ok ? await res.json() : [];
      const track = Array.isArray(data)
        ? data.find(t => (t.display || '').includes('English') && t.url) || null
        : null;
      return track ? track.url : '';
    }

    return '';
  } catch {
    return '';
  }
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    const contentId = buildContentId(tmdbId, mediaType, seasonNum, episodeNum);

    const [vidlink, vixsrc] = await Promise.all([
      fetchVidlink(contentId),
      fetchVixSrc(contentId)
    ]);

    const subtitleUrl = await fetchWyzieSubtitle(contentId);

    const out = [vidlink, vixsrc]
      .filter(Boolean)
      .sort((a, b) => (b._score || 0) - (a._score || 0))
      .map(({ _score, ...rest }) => ({
        ...rest,
        subtitles: subtitleUrl || undefined
      }));

    return out;
  } catch {
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
