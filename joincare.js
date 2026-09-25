const { ethers } = require('ethers');
const fs = require('fs');

const INVITE_CODE = 'RXC9Q0';
const BASE_URL = 'https://joincarelabs.com';

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

async function get(url, params = {}) {
  const u = new URL(url);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetch(u, { headers: HEADERS });
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  return res.json();
}

async function connectWallet(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const walletAddress = wallet.address;

  console.log(`\n[*] Processing: ${walletAddress}`);

  // Step 1: Check registration status
  const statusRes = await get(`${BASE_URL}/client/login/v1/registrationStatus`, { walletAddress });
  const { registered } = statusRes.data;
  console.log(`[*] Registered: ${registered}`);

  // Step 2: Get nonce
  const nonceRes = await get(`${BASE_URL}/client/auth/v1/nonce`, { walletAddress, action: 'register' });
  const { nonce, message } = nonceRes.data;
  console.log(`[*] Nonce: ${nonce}`);

  // Step 3: Sign message (EIP-191)
  const signature = await wallet.signMessage(message);
  console.log(`[*] Signature: ${signature.slice(0, 20)}...`);

  // Step 4: Register atau Login
  const endpoint = registered
    ? `${BASE_URL}/client/login/v1/login`
    : `${BASE_URL}/client/login/v1/register`;

  const registerRes = await post(endpoint, { walletAddress, inviteCode: INVITE_CODE, message, signature });
  const data = registerRes.data;
  console.log(`[+] Success! UID: ${data.uid}, Type: ${data.type}`);
  console.log(`[+] Auth Token: ${data.signature.slice(0, 30)}...`);

  return {
    walletAddress,
    uid: data.uid,
    authToken: data.signature,
    inviteCode: data.inviteCode,
    registered,
  };
}

// ---- Prompt Helper ----
function prompt(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    process.stdin.once('data', d => resolve(d.toString().trim()));
  });
}

// ---- Main ----
const ALL_KEYS = fs.readFileSync('wallet.txt', 'utf-8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l.length > 0);

(async () => {
  console.log(`\n===== JOINCARE BOT =====`);
  console.log(`Total wallet: ${ALL_KEYS.length}`);
  console.log(`\nPilih mode:`);
  console.log(`  1. Satu akun`);
  console.log(`  2. Semua akun`);
  console.log(`  3. Dari akun X sampai akhir`);

  const mode = await prompt('\nPilihan (1/2/3): ');

  let PRIVATE_KEYS;

  if (mode === '1') {
    const idx = await prompt(`Akun ke berapa? (1-${ALL_KEYS.length}): `);
    PRIVATE_KEYS = [ALL_KEYS[parseInt(idx) - 1]];
    console.log(`[*] Menjalankan akun ke-${idx}`);
  } else if (mode === '2') {
    PRIVATE_KEYS = ALL_KEYS;
    console.log(`[*] Menjalankan semua akun (${ALL_KEYS.length})`);
  } else if (mode === '3') {
    const from = await prompt(`Mulai dari akun ke berapa? (1-${ALL_KEYS.length}): `);
    PRIVATE_KEYS = ALL_KEYS.slice(parseInt(from) - 1);
    console.log(`[*] Menjalankan akun ke-${from} sampai akhir (${PRIVATE_KEYS.length} akun)`);
  } else {
    console.log('[-] Pilihan tidak valid.');
    process.exit(1);
  }

  process.stdin.destroy();

  const results = [];
  for (const pk of PRIVATE_KEYS) {
    try {
      const result = await connectWallet(pk);
      results.push(result);
      console.log(`[+] Done: ${result.walletAddress}`);
    } catch (err) {
      console.error(`[-] Error:`, err.message);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n===== SUMMARY =====');
  results.forEach(r => {
    console.log(`${r.walletAddress} | UID: ${r.uid} | Token: ${r.authToken.slice(0, 40)}...`);
  });
})();
