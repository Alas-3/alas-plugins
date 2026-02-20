const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const BASE = 'https://animepahe.si';
const PROXY_BASE = 'https://deno-proxies-sznvnpnxwhbv.deno.dev/?url=';
const PROVIDER_ID = 'alas-animepahedub';
const AUDIO_MODE = 'dub';

function proxied(url) {
  return PROXY_BASE + encodeURIComponent(url);
}

function getHeader(headers, key) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    return headers.get(key) || headers.get(key.toLowerCase());
  }
  return headers[key] || headers[key.toLowerCase()] || null;
}

function mergeCookies(baseCookie, extraCookie) {
  const parts = [];
  if (baseCookie) parts.push(String(baseCookie).trim().replace(/;+$/, ''));
  if (extraCookie) parts.push(String(extraCookie).trim().replace(/;+$/, ''));
  return parts.filter(Boolean).join('; ');
}

function isDdosBlocked(text) {
  return /DDoS-Guard|ddos-guard\/js-challenge|data-ddg-origin/i.test(String(text || ''));
}

async function safeFetch(url, options = {}) {
  if (typeof fetchv2 === 'function') {
    const headers = options.headers || {};
    const method = options.method || 'GET';
    const body = options.body || null;
    try {
      return await fetchv2(url, headers, method, body, true, 'utf-8');
    } catch {
    }
  }
  return fetch(url, options);
}

class DdosGuardInterceptor {
  constructor() {
    this.cookieStore = {};
  }

  storeCookies(setCookieHeader) {
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    cookies.forEach((cookieStr) => {
      if (!cookieStr) return;
      const first = String(cookieStr).split(';')[0] || '';
      const idx = first.indexOf('=');
      if (idx <= 0) return;
      const key = first.slice(0, idx).trim();
      const value = first.slice(idx + 1).trim();
      if (key) this.cookieStore[key] = value;
    });
  }

  getCookieHeader() {
    return Object.entries(this.cookieStore)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  async fetchWithCookies(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers.Cookie = mergeCookies(headers.Cookie, cookieHeader);
    }

    const response = await safeFetch(url, { ...options, headers });
    const setCookie = getHeader(response && response.headers, 'set-cookie');
    if (setCookie) this.storeCookies(setCookie);
    return response;
  }

  async getNewCookie(targetUrl) {
    try {
      const checkJs = await safeFetch('https://check.ddos-guard.net/check.js');
      const checkText = await checkJs.text();
      const pathMatch = checkText.match(/['"](\/\.well-known\/ddos-guard\/[^'"]+)['"]/);
      if (!pathMatch) return null;

      const baseMatch = String(targetUrl).match(/^(https?:\/\/[^/]+)/);
      if (!baseMatch) return null;

      const pixelUrl = `${baseMatch[1]}${pathMatch[1]}`;
      const pixelRes = await safeFetch(pixelUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: targetUrl
        }
      });
      const pixelSetCookie = getHeader(pixelRes && pixelRes.headers, 'set-cookie');
      if (pixelSetCookie) this.storeCookies(pixelSetCookie);
      return this.cookieStore.__ddg2_ || null;
    } catch {
      return null;
    }
  }

  async fetchWithBypass(url, options = {}) {
    let response = await this.fetchWithCookies(url, options);
    let text = '';
    try {
      text = await response.text();
    } catch {
      return response;
    }

    const blocked = (response && response.status === 403) || isDdosBlocked(text);
    if (!blocked) {
      response.text = async () => text;
      return response;
    }

    if (!this.cookieStore.__ddg2_) {
      await this.getNewCookie(url);
    }

    response = await this.fetchWithCookies(url, options);
    return response;
  }
}

const ddosInterceptor = new DdosGuardInterceptor();

function fetchTextWithFallback(url, options) {
  return ddosInterceptor.fetchWithBypass(url, options)
    .then(async (r) => {
      const text = r.ok ? await r.text() : '';
      if (!r.ok || isDdosBlocked(text)) {
        const proxyRes = await safeFetch(proxied(url), options);
        return proxyRes.ok ? proxyRes.text() : '';
      }
      return text;
    })
    .catch(() => safeFetch(proxied(url), options).then(r => (r.ok ? r.text() : '')).catch(() => ''));
}

function fetchJsonWithFallback(url, options) {
  return fetchTextWithFallback(url, options)
    .then((text) => {
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    });
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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
  qTokens.forEach(t => {
    if (cTokens.includes(t)) score += 45;
  });
  if (year && String(candidate).includes(String(year))) score += 100;
  return score;
}

function searchAnimepahe(query) {
  return fetchJsonWithFallback(`${BASE}/api?m=search&q=${encodeURIComponent(query)}`)
    .then((json) => {
      const data = (json && json.data) || [];
      return data.map(item => ({
        title: item.title,
        href: `${BASE}/anime/${item.session}`
      }));
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

function getEpisodeLink(animeUrl, episodeNum) {
  const uuidMatch = animeUrl.match(/\/anime\/([^/]+)/);
  if (!uuidMatch) return Promise.resolve(null);
  const animeId = uuidMatch[1];
  const wanted = Number(episodeNum || 1);

  function fetchPage(page) {
    return fetchJsonWithFallback(`${BASE}/api?m=release&id=${animeId}&sort=episode_asc&page=${page}`);
  }

  return fetchPage(1).then((first) => {
    if (!first || !Array.isArray(first.data)) return null;

    const findInData = (arr) => {
      const found = arr.find(item => Number(item.episode) === wanted);
      return found ? `${BASE}/play/${animeId}/${found.session}` : null;
    };

    const direct = findInData(first.data);
    if (direct) return direct;

    const last = Number(first.last_page || 1);
    if (last <= 1) return null;

    const pages = [];
    for (let p = 2; p <= last; p++) pages.push(fetchPage(p));

    return Promise.all(pages).then((all) => {
      for (const page of all) {
        if (!page || !Array.isArray(page.data)) continue;
        const match = findInData(page.data);
        if (match) return match;
      }
      return null;
    });
  });
}

class Unbaser {
  constructor(base) {
    this.ALPHABET = {
      62: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
      95: "' !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~'"
    };
    this.dictionary = {};
    this.base = base;
    if (36 < base && base < 62) {
      this.ALPHABET[base] = this.ALPHABET[base] || this.ALPHABET[62].substr(0, base);
    }
    if (2 <= base && base <= 36) {
      this.unbase = (value) => parseInt(value, base);
    } else {
      [...this.ALPHABET[base]].forEach((cipher, index) => {
        this.dictionary[cipher] = index;
      });
      this.unbase = this._dictunbaser;
    }
  }

  _dictunbaser(value) {
    let ret = 0;
    [...value].reverse().forEach((cipher, index) => {
      ret += (Math.pow(this.base, index) * this.dictionary[cipher]);
    });
    return ret;
  }
}

function unpack(source) {
  function filterArgs(src) {
    const juicers = [
      /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\), *(\d+), *(.*)\)\)/,
      /}\('(.*)', *(\d+|\[\]), *(\d+), *'(.*)'\.split\('\|'\)/
    ];
    for (const juicer of juicers) {
      const args = juicer.exec(src);
      if (args) {
        return {
          payload: args[1],
          symtab: args[4].split('|'),
          radix: parseInt(args[2], 10),
          count: parseInt(args[3], 10)
        };
      }
    }
    throw new Error('Could not parse packer payload');
  }

  const { payload, symtab, radix, count } = filterArgs(source);
  if (count !== symtab.length) throw new Error('Malformed packer symtab');

  const unbase = new Unbaser(radix);
  const lookup = (word) => {
    const index = radix === 1 ? parseInt(word, 10) : unbase.unbase(word);
    return symtab[index] || word;
  };

  return payload.replace(/\b\w+\b/g, lookup);
}

function extractKwik(buttonHtml) {
  const srcMatch = buttonHtml.match(/data-src="([^"]*)"/);
  const resMatch = buttonHtml.match(/data-resolution="([^"]*)"/);
  const audioMatch = buttonHtml.match(/data-audio="([^"]*)"/);

  if (!srcMatch || !srcMatch[1].includes('kwik.cx')) return null;
  return {
    kwikUrl: srcMatch[1],
    resolution: resMatch ? resMatch[1] : 'Unknown',
    audio: audioMatch ? audioMatch[1] : 'jpn'
  };
}

function resolvePlayUrl(entry) {
  return fetch(entry.kwikUrl)
    .then(r => (r.ok ? r.text() : ''))
    .then((html) => {
      const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
      if (!scriptMatch) return null;

      let scriptContent = scriptMatch[1];
      if (scriptContent.includes('));eval(')) {
        const parts = scriptContent.split('));eval(');
        if (parts.length === 2) {
          scriptContent = parts[1].substring(0, parts[1].length - 1);
        }
      }

      let unpacked = null;
      try {
        unpacked = unpack(scriptContent);
      } catch {
        return null;
      }

      const urlMatch = unpacked.match(/const source=\\?['"]([^'"]+)['"]/) || unpacked.match(/https:\/\/[^\s'";]+\.m3u8/);
      if (!urlMatch) return null;
      const hlsUrl = (urlMatch[1] || urlMatch[0]).replace(/\\+$/, '');

      const audioType = entry.audio === 'eng' ? 'Dub' : 'SUB';
      return {
        label: `${entry.resolution}p • ${audioType}`,
        url: hlsUrl,
        headers: {
          Referer: 'https://kwik.cx/',
          Origin: 'https://kwik.cx'
        }
      };
    })
    .catch(() => null);
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const episode = type === 'tv' ? Number(episodeNum || 1) : 1;

  return getTmdbDetails(tmdbId, type)
    .then((meta) => {
      if (!meta || !meta.title) return [];

      return searchAnimepahe(meta.title)
        .then(results => {
          const best = selectBestMatch(results, meta.title, meta.year);
          if (!best || !best.href) return [];

          return getEpisodeLink(best.href, episode)
            .then((playUrl) => {
              if (!playUrl) return [];

              return fetchTextWithFallback(playUrl, {
                headers: {
                  Cookie: AUDIO_MODE === 'dub' ? 'aud=eng;' : 'aud=jpn;'
                }
              })
                .then((html) => {
                  const buttonMatches = html.match(/<button[^>]*data-src="([^"]*)"[^>]*>/g) || [];
                  const entries = buttonMatches
                    .map(extractKwik)
                    .filter(Boolean)
                    .filter((entry) => (AUDIO_MODE === 'dub' ? entry.audio === 'eng' : entry.audio !== 'eng'));
                  if (entries.length === 0) return [];

                  return Promise.all(entries.map(resolvePlayUrl))
                    .then((resolved) => (resolved || [])
                      .filter(Boolean)
                      .map((item) => ({
                        name: `${PROVIDER_ID} - ${item.label}`,
                        title: `${meta.title} (${meta.year || 'Unknown'})`,
                        url: item.url,
                        quality: item.label.includes('1080') ? '1080p' : item.label.includes('720') ? '720p' : 'Auto',
                        headers: item.headers,
                        provider: PROVIDER_ID
                      }))
                    );
                });
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
