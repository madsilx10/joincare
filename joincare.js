const { ethers } = require('ethers');
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const INVITE_CODE = 'RXC9Q0';
const BASE_URL = 'https://joincarelabs.com';
const BSC_RPC = 'https://bsc-dataseed.binance.org/';
const CHECKIN_CONTRACT = ethers.getAddress('0xe029161be55922edf3ec9d222142edf057d196ee');
const CHECKIN_DATA = '0x183ff085';
const TG_BIND_SCRIPT = path.join(__dirname, 'tg_bind.py');

const HEADERS = {
  'Content-Type': 'application/json',
  'Jc-Language': 'en-us',
  'Accept': '*/*',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Sec-Ch-Ua': '"Mises";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
  'Sec-Ch-Ua-Mobile': '?1',
  'Sec-Ch-Ua-Platform': '"Android"',
  'Referer': `${BASE_URL}/?invite_code=${INVITE_CODE}`,
  'Origin': BASE_URL,
};

async function generateSignature(authToken, method, urlPath, body, requestId, uid, time) {
  let message = '';
  if (method !== 'GET' && body && body !== '""') message += body;
  message += urlPath;
  message += requestId;
  if (authToken) message += authToken.slice(-8);
  message += String(uid);
  message += String(time);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(authToken),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signedPost(urlPath, body, uid, authToken) {
  const requestId = crypto.randomUUID();
  const jcTime = String(Math.floor(Date.now() / 1000));
  const bodyStr = JSON.stringify(body);
  const sig = await generateSignature(authToken, 'POST', urlPath, bodyStr, requestId, uid, jcTime);
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Jc-Person': String(uid), 'Jc-Sign': authToken, 'Jc-Request-Id': requestId, 'Jc-Time': jcTime, 'Jc-Signature': sig },
    body: bodyStr,
  });
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    console.log(`[!] Non-JSON POST ${urlPath} (${res.status}): ${text.slice(0, 200)}`);
    return {};
  }
}

async function signedGet(urlPath, uid, authToken) {
  const requestId = crypto.randomUUID();
  const jcTime = String(Math.floor(Date.now() / 1000));
  const sig = await generateSignature(authToken, 'GET', urlPath, '', requestId, uid, jcTime);
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method: 'GET',
    headers: { ...HEADERS, 'Jc-Person': String(uid), 'Jc-Sign': authToken, 'Jc-Request-Id': requestId, 'Jc-Time': jcTime, 'Jc-Signature': sig },
  });
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch (e) {
    console.log(`[!] Non-JSON GET ${urlPath} (${res.status}): ${text.slice(0, 200)}`);
    return {};
  }
}

async function get(url, params = {}) {
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { headers: HEADERS });
  return res.json();
}

async function post(url, body, extraHeaders = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ---- Auth ----
async function connectWallet(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const walletAddress = wallet.address;
  console.log(`\n[*] ${walletAddress}`);

  const { data: { registered } } = await get(`${BASE_URL}/client/login/v1/registrationStatus`, { walletAddress });
  const action = registered ? 'login' : 'register';
  const { data: { nonce, message } } = await get(`${BASE_URL}/client/auth/v1/nonce`, { walletAddress, action });
  const signature = await wallet.signMessage(message);

  const endpoint = registered ? `${BASE_URL}/client/login/v1/login` : `${BASE_URL}/client/login/v1/register`;
  const { data } = await post(endpoint, { walletAddress, inviteCode: INVITE_CODE, message, signature });
  console.log(`[+] Auth OK! UID: ${data.uid}`);

  return { wallet, walletAddress, uid: data.uid, authToken: data.signature };
}

// ---- Task Info ----
async function getTaskInfo({ uid, authToken }) {
  const res = await signedGet('/client/taskhall/v1/info', uid, authToken);
  return res?.data || {};
}

// ---- CheckIn ----
async function checkIn({ wallet, walletAddress, uid, authToken }, taskInfo) {
  const info = taskInfo?.checkInTask;
  const todayDate = new Date().getUTCDate();

  if (info?.status === 'COMPLETED' && info?.checkedDates?.includes(todayDate)) {
    console.log(`[~] CheckIn sudah dilakukan hari ini, skip tx`);
    return info;
  }

  console.log(`[*] CheckIn: ${walletAddress}`);
  const provider = new ethers.JsonRpcProvider(BSC_RPC);
  const signer = wallet.connect(provider);

  const tx = await signer.sendTransaction({
    to: CHECKIN_CONTRACT,
    data: CHECKIN_DATA,
    gasLimit: 60000n,
    gasPrice: ethers.parseUnits('0.05', 'gwei'),
  });

  console.log(`[*] Tx: ${tx.hash}`);
  await tx.wait();
  console.log(`[*] Tx confirmed!`);

  await signedPost('/client/taskhall/v1/checkIn', { txHash: tx.hash }, uid, authToken);

  const reconcileRes = await signedPost('/client/taskhall/v1/checkIn/reconcile', {}, uid, authToken);
  const d = reconcileRes?.data;
  console.log(`[+] CheckIn OK! point=${d?.point}, total=${d?.totalPoint}, streak=${d?.continuousCheckInDays}`);

  return d;
}

// ---- Telegram Bind ----
async function bindTelegram({ uid, authToken }, sessionString) {
  console.log(`[*] Bind Telegram uid=${uid}`);

  const bindRes = await signedGet('/client/auth/v1/tgBindLink', uid, authToken);
  if (!bindRes?.data?.url) {
    console.log(`[-] tgBindLink gagal`);
    return false;
  }

  const botUrl = bindRes.data.url;
  let pyOut = '';
  try {
    pyOut = execFileSync('python', [TG_BIND_SCRIPT, sessionString, botUrl], {
      timeout: 60000, encoding: 'utf-8',
    }).trim();
  } catch (e) {
    pyOut = (e.stdout || '').trim() || e.message;
  }
  console.log(`[*] TG: ${pyOut}`);

  if (pyOut.startsWith('ERROR')) return false;

  const checkRes = await signedPost('/client/taskhall/v1/checkTgJoin', {}, uid, authToken);
  const verified = checkRes?.data?.verified;
  console.log(`[*] checkTgJoin: verified=${verified}`);

  const chatRes = await signedPost('/client/taskhall/v1/completeTask', { platform: 'telegram', task_key: 'chat' }, uid, authToken);
  console.log(`[+] completeTask chat: ${JSON.stringify(chatRes?.data)}`);

  return true;
}

// ---- X (Twitter) Bind ----
async function bindX({ uid, authToken }, xAccount) {
  console.log(`[*] Bind X uid=${uid}`);

  const urlRes = await signedPost('/client/login/v1/xLoginUrl', {}, uid, authToken);
  console.log(`[*] xLoginUrl response: ${JSON.stringify(urlRes)}`);
  if (!urlRes?.data?.url) {
    console.log(`[-] xLoginUrl gagal`);
    return false;
  }

  const oauthUrl = urlRes.data.url;
  const urlObj = new URL(oauthUrl);
  const state = urlObj.searchParams.get('state');
  const codeChallenge = urlObj.searchParams.get('code_challenge');
  const clientId = urlObj.searchParams.get('client_id');
  const redirectUri = urlObj.searchParams.get('redirect_uri');
  const xCookie = `auth_token=${xAccount.authToken}; ct0=${xAccount.ct0}`;

  const navHeaders = {
    'Cookie': xCookie,
    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://joincarelabs.com/',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'cross-site',
  };

  // STEP 1: GET x.com/i/oauth2/authorize — follow redirect manual
  // Kalau user sudah pernah authorize app ini, Twitter langsung 302 ke callback dengan code
  console.log(`[*] GET oauth X...`);
  const getRes = await fetch(oauthUrl, { method: 'GET', headers: navHeaders, redirect: 'follow' });
  const finalUrl = getRes.url;
  console.log(`[*] GET final URL: ${finalUrl.slice(0, 200)}`);
  console.log(`[*] GET status: ${getRes.status}`);

  // Kalau follow redirect mendarat di callback joincare
  if (finalUrl.includes('joincarelabs.com/callback')) {
    const cbUrl = new URL(finalUrl);
    const code = cbUrl.searchParams.get('code');
    if (code) {
      console.log(`[+] Code dapat dari GET redirect`);
      const loginRes = await signedPost('/client/auth/v1/xBinding', { code, state }, uid, authToken);
      console.log(`[+] Bind X: ${JSON.stringify(loginRes?.data)}`);
      return !!loginRes?.data;
    }
  }

  // Parse HTML untuk ambil authenticity_token
  const getBody = await getRes.text();
  const authTokenMatch = getBody.match(/name="authenticity_token"[^>]*value="([^"]+)"/);
  const authenticityToken = authTokenMatch?.[1] || '';
  console.log(`[*] authenticity_token: ${authenticityToken ? authenticityToken.slice(0, 20) + '...' : '(tidak ada)'}`);

  // Kumpulkan cookie baru dari GET
  const getCookies = {};
  const rawCookies = typeof getRes.headers.getSetCookie === 'function'
    ? getRes.headers.getSetCookie()
    : (getRes.headers.get('set-cookie') ? [getRes.headers.get('set-cookie')] : []);
  for (const c of rawCookies) {
    const m = c.match(/^([^=]+)=([^;]*)/);
    if (m) getCookies[m[1].trim()] = m[2].trim();
  }
  console.log(`[*] Cookie dari GET: ${Object.keys(getCookies).join(', ') || '(kosong)'}`);
  // Cari embedded JSON state di script tag
  const jsonStateMatch = getBody.match(/\{"oauth_token[^}]+\}/) || getBody.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/) || getBody.match(/"authCode":"([^"]+)"/) || getBody.match(/\"code\":\"([^\"]+)\"/);
  console.log(`[*] Embedded state: ${jsonStateMatch ? jsonStateMatch[0].slice(0, 200) : '(tidak ada)'}`);
  console.log(`[*] HTML length: ${getBody.length}`);
  // Log bagian tengah HTML (sering ada data di sana)
  console.log(`[*] HTML mid: ${getBody.slice(1000, 1500)}`);
  const freshCt0 = getCookies.ct0 || xAccount.ct0;
  const allCookies = { ...getCookies, auth_token: xAccount.authToken, ct0: freshCt0 };
  if (guestToken) allCookies['gt'] = guestToken;
  const freshCookie = Object.entries(allCookies).map(([k, v]) => `${k}=${v}`).join('; ');

  // Fetch guest token Twitter
  console.log(`[*] Fetch guest token...`);
  const gtRes = await fetch('https://api.x.com/1.1/guest/activate.json', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    },
  });
  const gtData = await gtRes.json();
  const guestToken = gtData?.guest_token || '';
  console.log(`[*] Guest token: ${guestToken ? guestToken.slice(0, 15) + '...' : '(gagal)'}`);

  console.log(`[*] POST authorize...`);
  const authorizeBody = new URLSearchParams({
    approval: 'true',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'tweet.read users.read follows.read like.read offline.access',
    state: state,
  });
  if (authenticityToken) authorizeBody.set('authenticity_token', authenticityToken);

  const authorizeRes = await fetch('https://api.x.com/2/oauth2/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA`,
      'Cookie': freshCookie,
      'X-Csrf-Token': freshCt0,
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'Origin': 'https://x.com',
      'Referer': oauthUrl,
      'X-Twitter-Auth-Type': 'OAuth2Session',
      'X-Twitter-Active-User': 'yes',
      ...(guestToken ? { 'X-Guest-Token': guestToken } : {}),
    },
    body: authorizeBody.toString(),
    redirect: 'manual',
  });

  console.log(`[*] POST status: ${authorizeRes.status}`);
  const postLocation = authorizeRes.headers.get('location') || '';
  console.log(`[*] POST location: ${postLocation.slice(0, 200)}`);

  // Cek redirect dari POST
  if (postLocation.includes('joincarelabs.com/callback')) {
    const cbUrl = new URL(postLocation);
    const code = cbUrl.searchParams.get('code');
    if (code) {
      console.log(`[+] Code dapat dari POST redirect`);
      const loginRes = await signedPost('/client/auth/v1/xBinding', { code, state }, uid, authToken);
      console.log(`[+] Bind X: ${JSON.stringify(loginRes?.data)}`);
      return !!loginRes?.data;
    }
  }

  // Cek response body JSON (beberapa flow return redirect_uri di body)
  const postText = await authorizeRes.text();
  console.log(`[*] POST body: ${postText.slice(0, 300)}`);
  let postData = {};
  try { postData = postText ? JSON.parse(postText) : {}; } catch(e) {}

  const redirectUrl = postData?.redirect_uri;
  if (redirectUrl) {
    const cbUrl = new URL(redirectUrl);
    const code = cbUrl.searchParams.get('code');
    if (code) {
      console.log(`[+] Code dapat dari POST body`);
      const loginRes = await signedPost('/client/auth/v1/xBinding', { code, state }, uid, authToken);
      console.log(`[+] Bind X: ${JSON.stringify(loginRes?.data)}`);
      return !!loginRes?.data;
    }
  }

  console.log(`[-] X authorize gagal: ${postText.slice(0, 200)}`);
  return false;
}

// ---- Prompt ----
function prompt(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.once('data', d => resolve(d.toString().trim()));
  });
}

// ---- Main ----
const ALL_KEYS = fs.readFileSync('wallet.txt', 'utf-8')
  .split('\n').map(l => l.trim()).filter(Boolean);

const ALL_SESSIONS = fs.existsSync('sessions.txt')
  ? fs.readFileSync('sessions.txt', 'utf-8').split('\n').map(l => l.trim()).filter(Boolean)
  : [];

const ALL_X_ACCOUNTS = (() => {
  if (!fs.existsSync('akun.txt')) return [];
  const lines = fs.readFileSync('akun.txt', 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
  const accounts = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    accounts.push({ authToken: lines[i], ct0: lines[i + 1] });
  }
  return accounts;
})();

(async () => {
  console.log(`\n===== JOINCARE BOT =====`);
  console.log(`Wallet: ${ALL_KEYS.length} | TG: ${ALL_SESSIONS.length} | X: ${ALL_X_ACCOUNTS.length}`);
  console.log(`\n  1. Satu akun\n  2. Semua akun\n  3. Dari akun X sampai akhir`);

  const mode = await prompt('\nMode (1/2/3): ');
  let indices = [];
  if (mode === '1') {
    const idx = parseInt(await prompt(`Akun ke? (1-${ALL_KEYS.length}): `)) - 1;
    indices = [idx];
  } else if (mode === '2') {
    indices = [...Array(ALL_KEYS.length).keys()];
  } else if (mode === '3') {
    const from = parseInt(await prompt(`Mulai dari akun ke? (1-${ALL_KEYS.length}): `)) - 1;
    indices = [...Array(ALL_KEYS.length).keys()].slice(from);
  } else {
    console.log('[-] Pilihan tidak valid.'); process.exit(1);
  }

  console.log(`\n  1. Semua task (skip yg sudah selesai)\n  2. Daily checkin aja`);
  const task = await prompt('\nTask (1/2): ');
  process.stdin.destroy();

  for (const i of indices) {
    const pk = ALL_KEYS[i];
    const session = ALL_SESSIONS[i];
    if (!pk) { console.log(`[-] Wallet ${i + 1} tidak ada`); continue; }

    try {
      const account = await connectWallet(pk);
      const taskInfo = await getTaskInfo(account);

      await checkIn(account, taskInfo);

      if (task === '1') {
        if (taskInfo?.telegramTask?.status === 'COMPLETED') {
          console.log(`[~] Bind TG sudah selesai, skip`);
        } else if (!session) {
          console.log(`[-] Session TG ${i + 1} tidak ada, skip bind TG`);
        } else {
          await bindTelegram(account, session);
        }

        if (taskInfo?.twitterTask?.status === 'COMPLETED') {
          console.log(`[~] Bind X sudah selesai, skip`);
        } else {
          const xAccount = ALL_X_ACCOUNTS[i];
          if (!xAccount) console.log(`[-] Akun X ${i + 1} tidak ada, skip bind X`);
          else await bindX(account, xAccount);
        }
      }
    } catch (err) {
      console.error(`[-] Error akun ${i + 1}:`, err.message);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n[+] Semua selesai!');
})();
