const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const BASE = 'https://hianime.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function tmdbFetch(path) {
  return fetch(`${TMDB_BASE}${path}?api_key=${TMDB_API_KEY}`)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
}

function getTmdbDetails(tmdbId, mediaType) {
  const path = mediaType === 'tv' ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
  return tmdbFetch(path).then((data) => {
    if (!data) return null;
    const title = mediaType === 'tv' ? data.name : data.title;
    const date = mediaType === 'tv' ? data.first_air_date : data.release_date;
    const year = date ? String(date).split('-')[0] : '';
    return { title, year };
  });
}

function scoreTitle(query, candidate, year) {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  let score = 0;
  if (q === c) score += 1100;
  if (c.includes(q)) score += 300;
  const qTokens = q.split(' ').filter(Boolean);
  const cTokens = c.split(' ').filter(Boolean);
  qTokens.forEach(t => {
    if (cTokens.includes(t)) score += 45;
  });
  if (year && String(candidate).includes(String(year))) score += 90;
  return score;
}

function searchHiAnime(keyword) {
  return fetch(`${BASE}/search?keyword=${encodeURIComponent(keyword)}`)
    .then(r => (r.ok ? r.text() : ''))
    .then((html) => {
      const blocks = html.split('<div class="flw-item">').slice(1);
      const results = [];

      blocks.forEach((block) => {
        const href = block.match(/<a href="([^"]+)"/);
        const title = block.match(/title="([^"]+?)"/);
        if (href && title) {
          results.push({
            href: href[1].trim(),
            title: decodeHtmlEntities(title[1].trim())
          });
        }
      });

      return results;
    })
    .catch(() => []);
}

function selectBestMatch(results, title, year) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const ranked = results
    .map(r => ({ ...r, score: scoreTitle(title, r.title, year) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] || null;
}

function ensureWatchPath(path) {
  if (!path) return '';
  if (/\/watch\//.test(path)) return path;
  return path.replace(/\/([^/]+)$/, '/watch/$1');
}

function getEpisodeIdFromWatchPath(watchPath, episodeNum) {
  return fetch(`${BASE}${watchPath}`)
    .then(r => (r.ok ? r.text() : ''))
    .then((watchHtml) => {
      const idMatch = watchHtml.match(/<div[^>]+id="wrapper"[^>]+data-id="(\d+)"[^>]*>/);
      if (!idMatch) return null;
      const movieId = idMatch[1];

      return fetch(`${BASE}/ajax/v2/episode/list/${movieId}`)
        .then(r => (r.ok ? r.json() : null))
        .then((json) => {
          const epHtml = (json && json.html) || '';
          const matches = [...epHtml.matchAll(/class="ssl-item\s+ep-item"[^>]+data-number="(\d+)"[^>]+data-id="(\d+)"/g)];
          if (matches.length === 0) return null;

          const wanted = Number(episodeNum || 1);
          const found = matches.find(m => Number(m[1]) === wanted);
          return found ? found[2] : matches[0][2];
        });
    });
}

function resolveSourceFromServer(serverId, label) {
  return fetch(`${BASE}/ajax/v2/episode/sources?id=${serverId}`)
    .then(r => (r.ok ? r.json() : null))
    .then((json) => {
      const iframeUrl = json && json.link;
      if (!iframeUrl) return null;

      return fetch(iframeUrl, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Referer: `${BASE}/`
        }
      })
        .then(r => (r.ok ? r.text() : ''))
        .then((iframeHtml) => {
          const videoTagMatch = iframeHtml.match(/data-id="([^"]+)"/);
          const nonceMatch = iframeHtml.match(/\b[a-zA-Z0-9]{48}\b/) || iframeHtml.match(/\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b.*?\b([a-zA-Z0-9]{16})\b/);
          if (!videoTagMatch || !nonceMatch) return null;

          const fileId = videoTagMatch[1];
          const nonce = nonceMatch.length === 4
            ? `${nonceMatch[1]}${nonceMatch[2]}${nonceMatch[3]}`
            : nonceMatch[0];

          const u = new URL(iframeUrl);
          const defaultDomain = `${u.protocol}//${u.host}/`;
          const getSourcesUrl = `${defaultDomain}embed-2/v3/e-1/getSources?id=${fileId}&_k=${nonce}`;

          return fetch(getSourcesUrl, {
            headers: {
              'User-Agent': UA,
              Accept: '*/*',
              Referer: `${BASE}/`
            }
          })
            .then(r => (r.ok ? r.json() : null))
            .then((sourcesJson) => {
              const videoUrl = sourcesJson && sourcesJson.sources && sourcesJson.sources[0] && sourcesJson.sources[0].file;
              if (!videoUrl) return null;
              return {
                label,
                url: videoUrl,
                headers: {
                  Referer: defaultDomain,
                  'User-Agent': UA
                }
              };
            });
        });
    })
    .catch(() => null);
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const episode = type === 'tv' ? Number(episodeNum || 1) : 1;

  return getTmdbDetails(tmdbId, type)
    .then((meta) => {
      if (!meta || !meta.title) return [];

      return searchHiAnime(meta.title)
        .then(results => {
          const best = selectBestMatch(results, meta.title, meta.year);
          if (!best || !best.href) return [];

          const watchPath = ensureWatchPath(best.href);
          return getEpisodeIdFromWatchPath(watchPath, episode)
            .then((episodeId) => {
              if (!episodeId) return [];

              return fetch(`${BASE}/ajax/v2/episode/servers?episodeId=${episodeId}`)
                .then(r => (r.ok ? r.json() : null))
                .then((serverJson) => {
                  const html = (serverJson && serverJson.html) || '';
                  const sub = (html.match(/data-type="sub" data-id="(\d+)"/) || [])[1];
                  const dub = (html.match(/data-type="dub" data-id="(\d+)"/) || [])[1];
                  const promises = [];
                  if (sub) promises.push(resolveSourceFromServer(sub, 'SUB'));
                  if (dub) promises.push(resolveSourceFromServer(dub, 'DUB'));
                  return Promise.all(promises);
                })
                .then((resolved) => (resolved || [])
                  .filter(Boolean)
                  .map(item => ({
                    name: `alas-hianime - ${item.label}`,
                    title: `${meta.title} (${meta.year || 'Unknown'})`,
                    url: item.url,
                    quality: '1080p',
                    headers: item.headers,
                    provider: 'alas-hianime'
                  }))
                );
            });
        });
    })
    .catch(() => []);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
