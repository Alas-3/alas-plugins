const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const PROVIDER_ID = 'alas-vidfast';

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

async function detectPlaylistMaxQuality(url, headers) {
  try {
    const res = await safeFetch(url, { headers: headers || {} });
    const text = res && res.ok ? await res.text() : '';
    return maxResolutionFromM3u8Text(text);
  } catch {
    return 0;
  }
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim().replace(/^0x/i, '').toLowerCase();
  if (!clean || clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function pkcs7Pad(bytes, blockSize = 16) {
  const mod = bytes.length % blockSize;
  const pad = mod === 0 ? blockSize : (blockSize - mod);
  const out = new Uint8Array(bytes.length + pad);
  out.set(bytes, 0);
  out.fill(pad, bytes.length);
  return out;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  // btoa exists on browsers; fall back to Buffer for Node
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function aesCbcEncryptPkcs7(plainText, keyBytes, ivBytes) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) ? globalThis.crypto.subtle : null;
  if (!subtle) throw new Error('WebCrypto subtle not available');

  const encoder = new TextEncoder();
  const padded = pkcs7Pad(encoder.encode(String(plainText || '')));
  const key = await subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt']);
  const cipherBuf = await subtle.encrypt({ name: 'AES-CBC', iv: ivBytes }, key, padded);
  return new Uint8Array(cipherBuf);
}

function convertPythonFString(str) {
  if (!str) return '';
  return String(str)
    .replace(/\{static_path\}/g, '{STATIC_PATH}')
    .replace(/\{encoded_final\}/g, '{ENCODED_FINAL}')
    .replace(/\{server\}/g, '{SERVER}');
}

async function fetchVidfastConfig() {
  const configUrl = 'https://raw.githubusercontent.com/yogesh-hacker/MediaVanced/refs/heads/main/sites/vidfast.py';
  const res = await safeFetch(configUrl);
  const text = res && res.ok ? await res.text() : '';
  if (!text) return null;

  const keyHexMatch = text.match(/key_hex\s*=\s*['"]([a-f0-9]+)['"]/i);
  const ivHexMatch = text.match(/iv_hex\s*=\s*['"]([a-f0-9]+)['"]/i);
  const xorKeyMatch = text.match(/xor_key\s*=\s*bytes\.fromhex\(['"]([a-f0-9]+)['"]\)/i);
  const staticPathMatch = text.match(/static_path\s*=\s*['"]([^'"]+)['"]/i);
  const sourceCharsMatch = text.match(/source_chars\s*=\s*['"]([^'"]+)['"]/i);
  const targetCharsMatch = text.match(/target_chars\s*=\s*['"]([^'"]+)['"]/i);
  const apiServersMatch = text.match(/api_servers\s*=\s*f?['"]([^'"]+)['"]/i);
  const apiStreamMatch = text.match(/api_stream\s*=\s*f?['"]([^'"]+)['"]/i);
  const userAgentMatch = text.match(/user_agent\s*=\s*['"]([^'"]+)['"]/i);
  const csrfTokenMatch = text.match(/["']X-Csrf-Token["']:\s*["']([^'"]+)["']/i);
  const refererMatch = text.match(/["']Referer["']:\s*["']([^'"]+)["']/i);

  if (!keyHexMatch || !ivHexMatch || !xorKeyMatch || !staticPathMatch || !sourceCharsMatch || !targetCharsMatch) {
    return null;
  }

  const clean = (s) => String(s || '').replace(/\s+/g, '').trim();

  return {
    aesKeyHex: keyHexMatch[1],
    aesIvHex: ivHexMatch[1],
    xorKeyHex: xorKeyMatch[1],
    staticPath: clean(staticPathMatch[1]),
    encodeSrc: clean(sourceCharsMatch[1]),
    encodeDst: clean(targetCharsMatch[1]),
    apiServers: convertPythonFString(apiServersMatch ? apiServersMatch[1] : 'https://vidfast.pro/{STATIC_PATH}/wfPFjh__qQ/{ENCODED_FINAL}'),
    apiStream: convertPythonFString(apiStreamMatch ? apiStreamMatch[1] : 'https://vidfast.pro/{STATIC_PATH}/AddlBFe5/{SERVER}'),
    userAgent: userAgentMatch ? userAgentMatch[1] : 'Mozilla/5.0',
    csrfToken: csrfTokenMatch ? csrfTokenMatch[1] : null,
    referer: refererMatch ? refererMatch[1] : 'https://vidfast.pro/'
  };
}

async function getPageDataToken(imdbId, isSeries, season, episode, headers) {
  const pageUrl = isSeries
    ? `https://vidfast.pro/tv/${encodeURIComponent(imdbId)}/${Number(season)}/${Number(episode)}`
    : `https://vidfast.pro/movie/${encodeURIComponent(imdbId)}`;

  const pageRes = await safeFetch(pageUrl, { headers });
  const pageText = pageRes && pageRes.ok ? await pageRes.text() : '';
  if (!pageText) return null;

  let match = pageText.match(/\\"en\\":\\"([^"]+)\\"/);
  if (!match) match = pageText.match(/"en":"([^"]+)"/);
  if (!match) match = pageText.match(/'en':'([^']+)'/);
  if (!match) match = pageText.match(/["']en["']:\s*["']([^"']+)["']/);
  return match ? match[1] : null;
}

async function vidfastResolve(imdbId, isSeries, season, episode) {
  const config = await fetchVidfastConfig();
  if (!config) return null;

  const headers = {
    Accept: '*/*',
    'User-Agent': config.userAgent,
    Referer: config.referer,
    'X-Requested-With': 'XMLHttpRequest'
  };
  if (config.csrfToken) headers['X-Csrf-Token'] = config.csrfToken;

  const rawData = await getPageDataToken(imdbId, isSeries, season, episode, headers);
  if (!rawData) return null;

  const keyBytes = hexToBytes(config.aesKeyHex);
  const ivBytes = hexToBytes(config.aesIvHex);
  const xorBytes = hexToBytes(config.xorKeyHex);

  const cipherBytes = await aesCbcEncryptPkcs7(rawData, keyBytes, ivBytes);

  const xorResult = new Uint8Array(cipherBytes.length);
  for (let i = 0; i < cipherBytes.length; i++) {
    xorResult[i] = cipherBytes[i] ^ xorBytes[i % xorBytes.length];
  }

  const base64Url = bytesToBase64Url(xorResult);
  let encodedFinal = '';
  for (const ch of base64Url) {
    const idx = config.encodeSrc.indexOf(ch);
    encodedFinal += idx !== -1 ? config.encodeDst[idx] : ch;
  }

  const apiServers = config.apiServers
    .replace('{STATIC_PATH}', config.staticPath)
    .replace('{ENCODED_FINAL}', encodedFinal);

  const serversRes = await safeFetch(apiServers, { headers });
  const serverList = serversRes && serversRes.ok ? await serversRes.json() : null;
  if (!Array.isArray(serverList) || serverList.length === 0) return null;

  const vFastObj = serverList.find(s => s && s.name === 'vFast');

  const tryServer = async (serverObj) => {
    const server = serverObj && serverObj.data;
    if (!server) return null;

    const apiStream = config.apiStream
      .replace('{STATIC_PATH}', config.staticPath)
      .replace('{SERVER}', server);

    const streamRes = await safeFetch(apiStream, { headers });
    if (!streamRes || !streamRes.ok) return null;
    const data = await streamRes.json().catch(() => null);
    if (!data || !data.url) return null;
    return data;
  };

  let defaultData = null;
  for (const serverObj of serverList) {
    const data = await tryServer(serverObj);
    if (!data) continue;
    if (String(data.url).includes('.m3u8')) {
      defaultData = data;
      break;
    }
  }

  const vFastData = vFastObj ? await tryServer(vFastObj) : null;

  const englishTrack = defaultData && Array.isArray(defaultData.tracks)
    ? defaultData.tracks.find(t => t && t.label && String(t.label).toLowerCase().includes('english') && t.file)
    : null;

  return {
    defaultUrl: defaultData ? defaultData.url : null,
    vFastUrl: vFastData ? vFastData.url : null,
    subtitles: englishTrack ? englishTrack.file : null,
    headers
  };
}

async function pick4kVariantFromMaster(masterUrl) {
  try {
    const headers = {
      Accept: '*/*',
      'User-Agent': 'Mozilla/5.0',
      Referer: 'https://vidfast.pro/'
    };
    const res = await safeFetch(masterUrl, { headers });
    const text = res && res.ok ? await res.text() : '';
    if (!text.includes('RESOLUTION=3840x2160')) return null;

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('RESOLUTION=3840x2160') && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (!next) continue;
        if (next.startsWith('http')) return next;
        const base = new URL(masterUrl);
        return `${base.protocol}//${base.host}${next.startsWith('/') ? '' : '/'}${next}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function tmdbFetch(path) {
  return safeFetch(`${TMDB_BASE}${path}?api_key=${TMDB_API_KEY}`)
    .then(r => (r && r.ok ? r.json() : null))
    .catch(() => null);
}

async function getImdbId(tmdbId, mediaType) {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  if (type === 'movie') {
    const movie = await tmdbFetch(`/movie/${tmdbId}`);
    return movie && movie.imdb_id ? movie.imdb_id : null;
  }

  const ext = await tmdbFetch(`/tv/${tmdbId}/external_ids`);
  return ext && ext.imdb_id ? ext.imdb_id : null;
}

async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    const type = mediaType === 'tv' ? 'tv' : 'movie';
    const imdbId = await getImdbId(tmdbId, type);
    if (!imdbId) return [];

    const result = await vidfastResolve(imdbId, type === 'tv', Number(seasonNum || 1), Number(episodeNum || 1));
    if (!result) return [];

    const streams = [];
    const headers = { Referer: 'https://vidfast.pro/' };

    if (result.defaultUrl) {
      const score = Math.max(inferQualityScore(result.defaultUrl), await detectPlaylistMaxQuality(result.defaultUrl, headers));
      if (score >= 1080) {
        streams.push({
          name: `${PROVIDER_ID} - 1080p`,
          url: result.defaultUrl,
          quality: toQualityLabel(score),
          headers,
          provider: PROVIDER_ID,
          _score: score
        });
      }
    }

    if (result.vFastUrl) {
      const fourKUrl = await pick4kVariantFromMaster(result.vFastUrl);
      if (fourKUrl) {
        const score = Math.max(2160, await detectPlaylistMaxQuality(fourKUrl, headers));
        if (score >= 1080) {
          streams.push({
            name: `${PROVIDER_ID} - 4K`,
            url: fourKUrl,
            quality: toQualityLabel(score),
            headers,
            provider: PROVIDER_ID,
            _score: score
          });
        }
      }
    }

    return streams
      .sort((a, b) => b._score - a._score)
      .map(({ _score, ...rest }) => rest);
  } catch {
    return [];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams };
} else {
  global.getStreams = getStreams;
}
