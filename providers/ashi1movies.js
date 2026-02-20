const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const ONE_MOVIES_BASE = 'https://1movies.bz';
const PROXY_BASE = 'https://deno-proxies-sznvnpnxwhbv.deno.dev/?url=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function proxied(url) {
  return PROXY_BASE + encodeURIComponent(url);
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function cleanJsonHtml(jsonHtml) {
  if (!jsonHtml) return '';
  return jsonHtml
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r');
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function titleScore(query, candidate, year) {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;

  let score = 0;
  if (q === c) score += 1000;
  if (c.includes(q)) score += 300;

  const qTokens = q.split(' ').filter(Boolean);
  const cTokens = c.split(' ').filter(Boolean);
  qTokens.forEach(t => {
    if (cTokens.includes(t)) score += 40;
  });

  if (year && candidate && String(candidate).includes(String(year))) {
    score += 120;
  }

  return score;
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

function searchOneMovies(query) {
  const encoded = encodeURIComponent(query);
  const urls = [
    `${ONE_MOVIES_BASE}/browser?keyword=${encoded}`,
    `${ONE_MOVIES_BASE}/browser?keyword=${encoded}&page=2`,
    `${ONE_MOVIES_BASE}/browser?keyword=${encoded}&page=3`
  ];

  return Promise.all(
    urls.map(url => fetch(proxied(url)).then(r => (r.ok ? r.text() : '')))
  ).then((pages) => {
    const out = [];
    const posterHrefRegex = /href="([^"]*)" class="poster"/g;
    const titleRegex = /class="title" href="[^"]*">([^<]*)</g;

    pages.forEach((html) => {
      const posterMatches = [...html.matchAll(posterHrefRegex)];
      const titleMatches = [...html.matchAll(titleRegex)];
      const minLen = Math.min(posterMatches.length, titleMatches.length);

      for (let i = 0; i < minLen; i++) {
        const href = posterMatches[i][1];
        const fullHref = href.startsWith('http') ? href : `${ONE_MOVIES_BASE}${href}`;
        const title = decodeHtmlEntities(titleMatches[i][1]);
        out.push({ href: fullHref, title });
      }
    });

    return out;
  });
}

function extractMovieId(detailHtml) {
  return (detailHtml.match(/<div class="detail-lower"[^>]*id="movie-rating"[^>]*data-id="([^"]+)"/) || [])[1] || null;
}

function getEpisodesList(movieId, targetEpisode) {
  return fetch(`https://enc-dec.app/api/enc-movies-flix?text=${encodeURIComponent(movieId)}`)
    .then(r => (r.ok ? r.json() : null))
    .then(tok => {
      const token = tok && tok.result;
      if (!token) return null;
      const listUrl = `${ONE_MOVIES_BASE}/ajax/episodes/list?id=${movieId}&_=${token}`;
      return fetch(proxied(listUrl)).then(r => (r.ok ? r.json() : null));
    })
    .then(listJson => {
      const html = cleanJsonHtml((listJson && listJson.result) || '');
      if (!html) return null;

      const matches = [...html.matchAll(/<a[^>]+eid="([^"]+)"[^>]+num="([^"]+)"[^>]*>/g)];
      if (matches.length === 0) return null;

      if (targetEpisode && Number.isFinite(targetEpisode)) {
        const wanted = matches.find(m => Number(m[2]) === Number(targetEpisode));
        if (wanted) return wanted[1];
      }

      return matches[0][1];
    });
}

function getMasterPlaylistFromEpisodeEid(eid) {
  return fetch(`https://enc-dec.app/api/enc-movies-flix?text=${encodeURIComponent(eid)}`)
    .then(r => (r.ok ? r.json() : null))
    .then(tok => {
      const token = tok && tok.result;
      if (!token) return null;

      const viewUrl = `${ONE_MOVIES_BASE}/ajax/links/view?id=${eid}&_=${token}`;
      return fetch(proxied(viewUrl)).then(r => (r.ok ? r.json() : null));
    })
    .then(viewJson => {
      const encrypted = viewJson && viewJson.result;
      if (!encrypted) return null;

      return fetch('https://enc-dec.app/api/dec-movies-flix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: encrypted })
      }).then(r => (r.ok ? r.json() : null));
    })
    .then(decJson => {
      const decryptedUrl = decJson && decJson.result && decJson.result.url;
      if (!decryptedUrl) return null;

      const mediaUrl = decryptedUrl.replace('/e/', '/media/');
      const headers = {
        Referer: `${ONE_MOVIES_BASE}/`,
        'User-Agent': UA
      };

      return fetch(mediaUrl, { headers })
        .then(r => (r.ok ? r.json() : null))
        .then(mediaJson => {
          const rapidEncrypted = mediaJson && mediaJson.result;
          if (!rapidEncrypted) return null;

          const rapidUrl = `https://enc-dec.app/api/dec-rapid?text=${encodeURIComponent(rapidEncrypted)}&agent=${encodeURIComponent(UA)}`;
          return fetch(rapidUrl).then(r => (r.ok ? r.json() : null));
        })
        .then(finalJson => finalJson && finalJson.result && finalJson.result.sources && finalJson.result.sources[0] && finalJson.result.sources[0].file);
    });
}

function parseM3U8Variants(masterUrl) {
  if (!masterUrl) return Promise.resolve([]);

  return fetch(masterUrl)
    .then(r => (r.ok ? r.text() : ''))
    .then((text) => {
      if (!text) return [];

      const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
      const lines = text.split('\n');
      const out = [];

      for (let i = 0; i < lines.length; i++) {
        const line = String(lines[i] || '').trim();
        if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;

        const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        const quality = resolutionMatch ? `${resolutionMatch[1].split('x')[1]}p` : 'Auto';
        const streamPath = String(lines[i + 1] || '').trim();
        if (!streamPath || streamPath.startsWith('#')) continue;

        const url = streamPath.startsWith('http') ? streamPath : `${baseUrl}${streamPath}`;
        out.push({ quality, url });
      }

      if (out.length === 0 && masterUrl.includes('.m3u8')) {
        out.push({ quality: 'Auto', url: masterUrl });
      }

      return out;
    })
    .catch(() => []);
}

function selectBestResult(results, title, year) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const ranked = results
    .map(r => ({ ...r, score: titleScore(title, r.title, year) }))
    .sort((a, b) => b.score - a.score);

  return ranked[0] || null;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const episode = type === 'tv' ? Number(episodeNum || 1) : 1;

  return getTmdbDetails(tmdbId, type)
    .then((meta) => {
      if (!meta || !meta.title) return [];

      return searchOneMovies(meta.title)
        .then(results => {
          const best = selectBestResult(results, meta.title, meta.year);
          if (!best || !best.href) return [];

          return fetch(proxied(best.href))
            .then(r => (r.ok ? r.text() : ''))
            .then(detailHtml => {
              const movieId = extractMovieId(detailHtml);
              if (!movieId) return [];

              return getEpisodesList(movieId, episode)
                .then(eid => {
                  if (!eid) return [];
                  return getMasterPlaylistFromEpisodeEid(eid);
                })
                .then(master => parseM3U8Variants(master))
                .then(variants => {
                  const playbackHeaders = {
                    Referer: `${ONE_MOVIES_BASE}/`,
                    'User-Agent': UA
                  };

                  return variants.map(v => ({
                    name: `Ashi 1Movies - ${v.quality}`,
                    title: `${meta.title} (${meta.year || 'Unknown'})`,
                    url: v.url,
                    quality: v.quality,
                    headers: playbackHeaders,
                    provider: 'ashi1movies'
                  }));
                });
            });
        });
    })
    .catch((err) => {
      console.error('[Ashi1Movies] Error:', err && err.message ? err.message : err);
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
