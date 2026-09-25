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
  console.log(`[debug] POST ${urlPath} →`, text.slice(0, 300));
  return text ? JSON.parse(text) : {};
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
  console.log(`[debug] GET ${urlPath} →`, text.slice(0, 300));
  return text ? JSON.parse(text) : {};
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

// ---- CheckIn ----
async function checkIn({ wallet, walletAddress, uid, authToken }) {
  // Cek apakah sudah checkin hari ini
  const infoRes = await signedGet('/client/taskhall/v1/checkIn/info', uid, authToken);
  const info = infoRes?.data;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  if (info?.chainStatus === 'confirmed' && info?.checkInDate === today) {
    console.log(`[~] CheckIn sudah dilakukan hari ini (${today}), skip tx`);
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

(async () => {
  console.log(`\n===== JOINCARE BOT =====`);
  console.log(`Wallet: ${ALL_KEYS.length} | TG Session: ${ALL_SESSIONS.length}`);
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

  console.log(`\n  1. CheckIn daily\n  2. Bind Telegram\n  3. CheckIn + Bind Telegram`);
  const task = await prompt('\nTask (1/2/3): ');
  process.stdin.destroy();

  for (const i of indices) {
    const pk = ALL_KEYS[i];
    const session = ALL_SESSIONS[i];
    if (!pk) { console.log(`[-] Wallet ${i + 1} tidak ada`); continue; }

    try {
      const account = await connectWallet(pk);
      if (task === '1' || task === '3') await checkIn(account);
      if (task === '2' || task === '3') {
        if (!session) console.log(`[-] Session TG ${i + 1} tidak ada, skip`);
        else await bindTelegram(account, session);
      }
    } catch (err) {
      console.error(`[-] Error akun ${i + 1}:`, err.message);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n[+] Semua selesai!');
})();
