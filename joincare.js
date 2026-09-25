const { ethers } = require('ethers');
const axios = require('axios');

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

async function connectWallet(privateKey) {
  const wallet = new ethers.Wallet(privateKey);
  const walletAddress = wallet.address;

  console.log(`\n[*] Processing: ${walletAddress}`);

  // Step 1: Check registration status
  const statusRes = await axios.get(`${BASE_URL}/client/login/v1/registrationStatus`, {
    params: { walletAddress },
    headers: HEADERS,
  });

  const { registered } = statusRes.data.data;
  console.log(`[*] Registered: ${registered}`);

  // Step 2: Get nonce
  const nonceRes = await axios.get(`${BASE_URL}/client/auth/v1/nonce`, {
    params: { walletAddress, action: 'register' },
    headers: HEADERS,
  });

  const { nonce, message } = nonceRes.data.data;
  console.log(`[*] Nonce: ${nonce}`);

  // Step 3: Sign message (EIP-191 personal_sign)
  const signature = await wallet.signMessage(message);
  console.log(`[*] Signature: ${signature.slice(0, 20)}...`);

  // Step 4: Register atau Login tergantung status
  const endpoint = registered
    ? `${BASE_URL}/client/login/v1/login`
    : `${BASE_URL}/client/login/v1/register`;

  const registerRes = await axios.post(endpoint, {
    walletAddress,
    inviteCode: INVITE_CODE,
    message,
    signature,
  }, { headers: HEADERS });

  const data = registerRes.data.data;
  console.log(`[+] Success! UID: ${data.uid}, Type: ${data.type}`);
  console.log(`[+] Auth Token: ${data.signature.slice(0, 30)}...`);

  return {
    walletAddress,
    uid: data.uid,
    authToken: data.signature, // JWT buat step berikutnya
    inviteCode: data.inviteCode,
    registered,
  };
}

// ---- Main ----
const PRIVATE_KEYS = [
  '0xYOUR_PRIVATE_KEY_HERE',
  // tambah wallet lain di sini
];

(async () => {
  const results = [];

  for (const pk of PRIVATE_KEYS) {
    try {
      const result = await connectWallet(pk);
      results.push(result);
      console.log(`[+] Done: ${result.walletAddress}`);
    } catch (err) {
      console.error(`[-] Error:`, err.response?.data || err.message);
    }
    // delay antar wallet biar ga kena rate limit
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n===== SUMMARY =====');
  results.forEach(r => {
    console.log(`${r.walletAddress} | UID: ${r.uid} | Token: ${r.authToken.slice(0, 40)}...`);
  });
})();
