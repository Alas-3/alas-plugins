const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const ANILIST_API = 'https://graphql.anilist.co';
const ANIMEKAI_BASE = 'https://anikai.to';
const PROXY_BASE = 'https://deno-proxies-sznvnpnxwhbv.deno.dev/?url=';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';

function proxied(url) {
  return PROXY_BASE + encodeURIComponent(url);
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
  if (q === c) score += 1200;
  if (c.includes(q)) score += 300;

  const qTokens = q.split(' ').filter(Boolean);
  const cTokens = c.split(' ').filter(Boolean);
  qTokens.forEach(token => {
    if (cTokens.includes(token)) score += 50;
  });

  if (year && String(candidate).includes(String(year))) score += 100;
  return score;
}

function searchAnimekai(query) {
  const encoded = encodeURIComponent(query);
  const urls = [
    `${ANIMEKAI_BASE}/browser?keyword=${encoded}`,
    `${ANIMEKAI_BASE}/browser?keyword=${encoded}&page=2`,
    `${ANIMEKAI_BASE}/browser?keyword=${encoded}&page=3`
  ];

  return Promise.all(
    urls.map(url => fetch(proxied(url)).then(r => (r.ok ? r.text() : '')))
  ).then((pages) => {
    const out = [];
    const posterRegex = /href="([^"]*)" class="poster"/g;
    const titleRegex = /class="title"[^>]*title="([^"]*)"/g;

    pages.forEach((html) => {
      const posters = [...html.matchAll(posterRegex)];
      const titles = [...html.matchAll(titleRegex)];
      const minLen = Math.min(posters.length, titles.length);

      for (let i = 0; i < minLen; i++) {
        const href = posters[i][1];
        const fullHref = href.startsWith('http') ? href : `${ANIMEKAI_BASE}${href}`;
        const title = decodeHtmlEntities(titles[i][1]);
        out.push({ href: fullHref, title });
      }
    });

    return out;
  });
}

function selectBestMatch(results, title, year) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const ranked = results
    .map(r => ({ ...r, score: scoreTitle(title, r.title, year) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] || null;
}

function tmdbToAnilistMalId(title, year) {
  if (!title) return Promise.resolve(null);

  return fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query ($search: String, $seasonYear: Int) {\n  Page(perPage: 5) {\n    media(search: $search, seasonYear: $seasonYear, type: ANIME) {\n      idMal\n      title { romaji english native }\n    }\n  }\n}`,
      variables: { search: title, seasonYear: year ? Number(year) : null }
    })
  })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      const first = j && j.data && j.data.Page && j.data.Page.media && j.data.Page.media[0];
      return first && first.idMal ? first.idMal : null;
    })
    .catch(() => null);
}

function getEpisodeToken(detailUrl, episodeNum) {
  return fetch(proxied(detailUrl))
    .then(r => (r.ok ? r.text() : ''))
    .then((detailHtml) => {
      const aniId = (detailHtml.match(/<div class="rate-box"[^>]*data-id="([^"]+)"/) || [])[1];
      if (!aniId) return null;

      return fetch(`https://enc-dec.app/api/enc-kai?text=${encodeURIComponent(aniId)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(enc => {
          const token = enc && enc.result;
          if (!token) return null;

          const episodesUrl = `${ANIMEKAI_BASE}/ajax/episodes/list?ani_id=${aniId}&_=${token}`;
          return fetch(proxied(episodesUrl)).then(r => (r.ok ? r.json() : null));
        })
        .then(listJson => {
          const html = cleanJsonHtml((listJson && listJson.result) || '');
          if (!html) return null;

          const matches = [...html.matchAll(/<a[^>]+num="([^"]+)"[^>]+token="([^"]+)"[^>]*>/g)];
          if (matches.length === 0) return null;

          const wantedEp = Number(episodeNum || 1);
          const found = matches.find(m => Number(m[1]) === wantedEp);
          return found ? found[2] : matches[0][2];
        });
    });
}

function getServerIds(episodeToken) {
  if (!episodeToken) return Promise.resolve([]);

  return fetch(`https://enc-dec.app/api/enc-kai?text=${encodeURIComponent(episodeToken)}`)
    .then(r => (r.ok ? r.json() : null))
    .then(enc => {
      const token = enc && enc.result;
      if (!token) return null;
      const linksUrl = `${ANIMEKAI_BASE}/ajax/links/list?token=${episodeToken}&_=${token}`;
      return fetch(proxied(linksUrl)).then(r => (r.ok ? r.text() : ''));
    })
    .then((text) => {
      const html = cleanJsonHtml(text || '');
      if (!html) return [];

      const groups = [
        { label: 'SUB', key: 'sub' },
        { label: 'SOFTSUB', key: 'softsub' },
        { label: 'DUB', key: 'dub' }
      ];

      const out = [];
      groups.forEach((group) => {
        const blockRegex = new RegExp(`<div class="server-items lang-group" data-id="${group.key}"[^>]*>([\\s\\S]*?)<\\/div>`);
        const block = (html.match(blockRegex) || [])[1] || '';
        const serverId = (block.match(/data-lid="([^"]+)"/) || [])[1];
        if (serverId) out.push({ type: group.label, serverId });
      });

      return out;
    })
    .catch(() => []);
}

function resolvePlayableStream(serverInfo) {
  const serverId = serverInfo.serverId;
  if (!serverId) return Promise.resolve(null);

  return fetch(`https://enc-dec.app/api/enc-kai?text=${encodeURIComponent(serverId)}`)
    .then(r => (r.ok ? r.json() : null))
    .then(enc => {
      const token = enc && enc.result;
      if (!token) return null;
      const viewUrl = `${ANIMEKAI_BASE}/ajax/links/view?id=${serverId}&_=${token}`;
      return fetch(proxied(viewUrl)).then(r => (r.ok ? r.json() : null));
    })
    .then(viewJson => {
      const encrypted = viewJson && viewJson.result;
      if (!encrypted) return null;

      return fetch(`https://enc-dec.app/api/dec-kai?text=${encodeURIComponent(encrypted)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(dec => dec && dec.result && dec.result.url ? dec.result.url : null);
    })
    .then((embedUrl) => {
      if (!embedUrl) return null;

      const mediaUrl = embedUrl.replace('/e/', '/media/');
      return fetch(mediaUrl, {
        headers: {
          Referer: `${ANIMEKAI_BASE}/`,
          'User-Agent': UA
        }
      })
        .then(r => (r.ok ? r.json() : null))
        .then(mediaJson => {
          const mediaEncrypted = mediaJson && mediaJson.result;
          if (!mediaEncrypted) return null;

          return fetch('https://enc-dec.app/api/dec-mega', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: mediaEncrypted, agent: UA })
          })
            .then(r => (r.ok ? r.json() : null))
            .then(finalJson => {
              const file = finalJson && finalJson.result && finalJson.result.sources && finalJson.result.sources[0] && finalJson.result.sources[0].file;
              if (!file) return null;
              return { type: serverInfo.type, url: file };
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

      return tmdbToAnilistMalId(meta.title, meta.year)
        .then(() => searchAnimekai(meta.title))
        .then(results => {
          const best = selectBestMatch(results, meta.title, meta.year);
          if (!best || !best.href) return [];

          return getEpisodeToken(best.href, episode)
            .then(getServerIds)
            .then((servers) => {
              if (!servers || servers.length === 0) return [];
              return Promise.all(servers.map(resolvePlayableStream));
            })
            .then((resolved) => {
              const playbackHeaders = {
                Referer: `${ANIMEKAI_BASE}/`,
                'User-Agent': UA
              };

              return (resolved || [])
                .filter(Boolean)
                .map((streamObj) => ({
                  name: `alas-animekai - ${streamObj.type}`,
                  title: `${meta.title} (${meta.year || 'Unknown'})`,
                  url: streamObj.url,
                  quality: '1080p',
                  headers: playbackHeaders,
                  provider: 'alas-animekai'
                }));
            });
        });
    })
    .catch((err) => {
      console.error('[alas-animekai] Error:', err && err.message ? err.message : err);
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
