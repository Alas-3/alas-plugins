const PROVIDER_ID = 'alas-checkmate';

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

async function soraFetch(url, options = { headers: {}, method: 'GET', body: null, encoding: 'utf-8' }) {
  try {
    return await safeFetch(url, options);
  } catch {
    return null;
  }
}

function buildContentId(tmdbId, mediaType, seasonNum, episodeNum) {
  if (mediaType === 'tv') {
    return `/tv/${tmdbId}/${Number(seasonNum || 1)}/${Number(episodeNum || 1)}`;
  }
  return `/movie/${tmdbId}`;
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

function normalizeStreams(rawResult, fallbackName) {
  const streams = [];
  const payloadStreams = (rawResult && rawResult.streams) || [];

  if (Array.isArray(payloadStreams) && payloadStreams.length > 0) {
    if (typeof payloadStreams[0] === 'string') {
      for (let i = 0; i < payloadStreams.length; i += 2) {
        const label = payloadStreams[i] || fallbackName;
        const url = payloadStreams[i + 1];
        if (!url || typeof url !== 'string') continue;
        const score = Math.max(inferQualityScore(label), inferQualityScore(url));
        if (score < 1080) continue;
        streams.push({
          name: `${PROVIDER_ID} - ${label}`,
          url,
          quality: toQualityLabel(score),
          headers: rawResult.referer ? { Referer: rawResult.referer } : {},
          provider: PROVIDER_ID,
          _score: score
        });
      }
    } else {
      payloadStreams.forEach((item) => {
        if (!item || !item.streamUrl) return;
        const score = Math.max(inferQualityScore(item.title), inferQualityScore(item.streamUrl));
        if (score < 1080) return;
        streams.push({
          name: `${PROVIDER_ID} - ${item.title || fallbackName}`,
          url: item.streamUrl,
          quality: toQualityLabel(score),
          headers: item.headers || (rawResult.referer ? { Referer: rawResult.referer } : {}),
          provider: PROVIDER_ID,
          _score: score
        });
      });
    }
  }

  return streams
    .sort((a, b) => b._score - a._score)
    .map(({ _score, ...rest }) => rest);
}

async function alpha(contentId) {
  if (contentId.includes('/movie/')) {
    const tmdbId = contentId.replace('/movie/', '');
    const cinebyResponse = await soraFetch(`https://db.videasy.net/3/movie/${tmdbId}?append_to_response=external_ids&language=en&api_key=ad301b7cc82ffe19273e55e4d4206885`);
    const cinebyData = cinebyResponse ? await cinebyResponse.json() : null;
    if (!cinebyData || !cinebyData.id) return null;

    const title = encodeURIComponent(cinebyData.title || '');
    const year = cinebyData.release_date ? new Date(cinebyData.release_date).getFullYear() : '';
    const imdbId = cinebyData.external_ids && cinebyData.external_ids.imdb_id ? cinebyData.external_ids.imdb_id : '';
    const fullUrl = `https://api.videasy.net/cdn/sources-with-title?title=${title}&mediaType=movie&year=${year}&episodeId=1&seasonId=1&tmdbId=${cinebyData.id}&imdbId=${imdbId}`;

    const encryptedResponse = await soraFetch(fullUrl);
    const encryptedText = encryptedResponse ? await encryptedResponse.text() : '';
    if (!encryptedText) return null;

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    const decResponse = await safeFetch('https://enc-dec.app/api/dec-videasy', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: encryptedText, id: tmdbId.split('-')[0] })
    });
    const decData = decResponse ? await decResponse.json() : null;
    const result = (decData && decData.result) || {};

    const streamObjects = (result.sources || [])
      .filter(s => s && s.url && !(s.quality || '').includes('HDR'))
      .map(src => ({
        title: src.quality || 'Auto',
        streamUrl: src.url,
        headers: {
          Origin: 'https://player.videasy.net',
          Referer: 'https://player.videasy.net/'
        }
      }));

    return { streams: streamObjects, subtitle: null };
  }

  if (contentId.includes('/tv/')) {
    const parts = contentId.split('/');
    const tmdbId = parts[2];
    const season = parts[3];
    const episode = parts[4];

    const cinebyResponse = await soraFetch(`https://db.videasy.net/3/tv/${tmdbId}?append_to_response=external_ids&language=en&api_key=ad301b7cc82ffe19273e55e4d4206885`);
    const cinebyData = cinebyResponse ? await cinebyResponse.json() : null;
    if (!cinebyData || !cinebyData.id) return null;

    const title = encodeURIComponent(cinebyData.name || '');
    const year = cinebyData.first_air_date ? new Date(cinebyData.first_air_date).getFullYear() : '';
    const imdbId = cinebyData.external_ids && cinebyData.external_ids.imdb_id ? cinebyData.external_ids.imdb_id : '';
    const fullUrl = `https://api.videasy.net/cdn/sources-with-title?title=${title}&mediaType=tv&year=${year}&episodeId=${episode}&seasonId=${season}&tmdbId=${cinebyData.id}&imdbId=${imdbId}`;

    const encryptedResponse = await soraFetch(fullUrl);
    const encryptedText = encryptedResponse ? await encryptedResponse.text() : '';
    if (!encryptedText) return null;

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    const decResponse = await safeFetch('https://enc-dec.app/api/dec-videasy', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: encryptedText, id: tmdbId.split('-')[0] })
    });
    const decData = decResponse ? await decResponse.json() : null;
    const result = (decData && decData.result) || {};

    const streamObjects = (result.sources || [])
      .filter(s => s && s.url && !(s.quality || '').includes('HDR'))
      .map(src => ({
        title: src.quality || 'Auto',
        streamUrl: src.url,
        headers: {
          Origin: 'https://player.videasy.net',
          Referer: 'https://player.videasy.net/'
        }
      }));

    return { streams: streamObjects, subtitle: null };
  }

  return null;
}

async function gamma(contentId) {
  if (!contentId.includes('/movie/') && !contentId.includes('/tv/')) return null;

  const parts = contentId.split('/');
  const tmdbId = parts[2];
  const encResponse = await safeFetch(`https://enc-dec.app/api/enc-vidlink?text=${tmdbId}`);
  const encData = encResponse ? await encResponse.json() : null;
  const encodedId = encData && encData.result;
  if (!encodedId) return null;

  let apiUrl = '';
  if (contentId.includes('/movie/')) {
    apiUrl = `https://vidlink.pro/api/b/movie/${encodedId}?multiLang=0`;
  } else {
    const season = parts[3];
    const episode = parts[4];
    apiUrl = `https://vidlink.pro/api/b/tv/${encodedId}/${season}/${episode}?multiLang=0`;
  }

  const response = await safeFetch(apiUrl);
  const data = response ? await response.json() : null;
  const playlist = data && data.stream && data.stream.playlist;
  if (!playlist) return null;

  return {
    streams: ['Primary', playlist],
    subtitles: null,
    referer: 'https://vidlink.pro'
  };
}

async function delta(contentId) {
  if (!contentId.includes('/movie/') && !contentId.includes('/tv/')) return null;

  const parts = contentId.split('/');
  const tmdbId = parts[2];
  const headersOne = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'X-Api-Key': '24ef089ebcab51d107a4e4709e87861ef609bace89ac23af13235f6ea743488f'
  };

  const sourceUrl = contentId.includes('/movie/')
    ? `https://themoviedb.hexa.su/api/tmdb/movie/${tmdbId}/images`
    : `https://themoviedb.hexa.su/api/tmdb/tv/${tmdbId}/season/${parts[3]}/episode/${parts[4]}/images`;

  const encryptedResponse = await safeFetch(sourceUrl, { headers: headersOne });
  const encryptedText = encryptedResponse ? await encryptedResponse.text() : '';
  if (!encryptedText) return null;

  const decResponse = await safeFetch('https://enc-dec.app/api/dec-hexa', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: JSON.stringify({
      text: encryptedText,
      key: '24ef089ebcab51d107a4e4709e87861ef609bace89ac23af13235f6ea743488f'
    })
  });

  const decData = decResponse ? await decResponse.json() : null;
  const sources = (decData && decData.result && decData.result.sources) || [];
  const streams = sources.flatMap(src => [
    src.server ? src.server.charAt(0).toUpperCase() + src.server.slice(1) : 'Source',
    src.url
  ]);

  return { streams, subtitles: null };
}

function firstValid(arr) {
  for (const item of arr) {
    if (item && Array.isArray(item) && item.length > 0) return item;
  }
  return [];
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    const contentId = buildContentId(tmdbId, mediaType, seasonNum, episodeNum);

    const [alphaRes, gammaRes, deltaRes] = await Promise.allSettled([
      alpha(contentId),
      gamma(contentId),
      delta(contentId)
    ]);

    const alphaStreams = alphaRes.status === 'fulfilled' ? normalizeStreams(alphaRes.value, 'Alpha') : [];
    const gammaStreams = gammaRes.status === 'fulfilled' ? normalizeStreams(gammaRes.value, 'Gamma') : [];
    const deltaStreams = deltaRes.status === 'fulfilled' ? normalizeStreams(deltaRes.value, 'Delta') : [];

    return firstValid([alphaStreams, gammaStreams, deltaStreams]);
  } catch {
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
