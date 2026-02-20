/* Temporary debug script (will be deleted after diagnosis). */

async function safeFetch(url, options = {}) {
  return fetch(url, options);
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim().replace(/^0x/i, '').toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
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
  const base64 = Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function aesCbcEncryptPkcs7(plainText, keyBytes, ivBytes) {
  const subtle = (globalThis.crypto && globalThis.crypto.subtle) ? globalThis.crypto.subtle : null;
  if (!subtle) throw new Error('no subtle');
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

(async () => {
  const cfgUrl = 'https://raw.githubusercontent.com/yogesh-hacker/MediaVanced/refs/heads/main/sites/vidfast.py';
  const cfgText = await (await safeFetch(cfgUrl)).text();
  const keyHex = (cfgText.match(/key_hex\s*=\s*['\"]([a-f0-9]+)['\"]/i) || [])[1];
  const ivHex = (cfgText.match(/iv_hex\s*=\s*['\"]([a-f0-9]+)['\"]/i) || [])[1];
  const xorHex = (cfgText.match(/xor_key\s*=\s*bytes\.fromhex\(['\"]([a-f0-9]+)['\"]\)/i) || [])[1];
  const staticPath = ((cfgText.match(/static_path\s*=\s*['\"]([^'\"]+)['\"]/i) || [])[1] || '').replace(/\s+/g, '');
  const srcChars = ((cfgText.match(/source_chars\s*=\s*['\"]([^'\"]+)['\"]/i) || [])[1] || '').replace(/\s+/g, '');
  const dstChars = ((cfgText.match(/target_chars\s*=\s*['\"]([^'\"]+)['\"]/i) || [])[1] || '').replace(/\s+/g, '');
  const apiServersTpl = convertPythonFString((cfgText.match(/api_servers\s*=\s*f?['\"]([^'\"]+)['\"]/i) || [])[1]);
  console.log({ keyHex: !!keyHex, ivHex: !!ivHex, xorHex: !!xorHex, staticPathLen: staticPath.length, srcLen: srcChars.length, dstLen: dstChars.length, apiServersTpl });

  const page = await (await safeFetch('https://vidfast.pro/movie/tt0133093', { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://vidfast.pro/' } })).text();
  const token = (page.match(/\\"en\\":\\"([^\"]+)\\"/) || page.match(/"en":"([^\"]+)"/) || page.match(/"en":"([^"]+)"/) || [])[1];
  console.log('tokenLen', token ? token.length : 0);

  const cipher = await aesCbcEncryptPkcs7(token, hexToBytes(keyHex), hexToBytes(ivHex));
  const xorKey = hexToBytes(xorHex);
  const xorResult = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i++) xorResult[i] = cipher[i] ^ xorKey[i % xorKey.length];
  const b64u = bytesToBase64Url(xorResult);
  let encFinal = '';
  for (const ch of b64u) {
    const idx = srcChars.indexOf(ch);
    encFinal += idx !== -1 ? dstChars[idx] : ch;
  }
  console.log('encFinalLen', encFinal.length);

  const apiServers = apiServersTpl.replace('{STATIC_PATH}', staticPath).replace('{ENCODED_FINAL}', encFinal);
  console.log('apiServers url head', apiServers.slice(0, 120));
  const serversRes = await safeFetch(apiServers, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://vidfast.pro/', 'X-Requested-With': 'XMLHttpRequest' } });
  console.log('servers status', serversRes.status);
  const serversText = await serversRes.text();
  console.log('servers head', serversText.slice(0, 200));
})();
