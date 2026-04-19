const BASE_URL = 'http://localhost:5000';

const test = async () => {
  let adminToken = '';
  let userToken = '';

  console.log('\n========== 1. ADMIN LOGIN ==========');
  const adminLogin = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@battlenix.com', password: 'admin123' }),
  });
  const adminData = await adminLogin.json();
  adminToken = adminData.token;
  console.log('Status:', adminLogin.status);
  console.log('Response:', JSON.stringify(adminData, null, 2));

  console.log('\n========== 2. HEALTH CHECK ==========');
  const health = await fetch(`${BASE_URL}/health`);
  console.log('Status:', health.status);
  console.log('Response:', JSON.stringify(await health.json(), null, 2));

  console.log('\n========== 3. REGISTER USER ==========');
  const register = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testuser1', email: 'test1@example.com', password: 'test1234' }),
  });
  const registerData = await register.json();
  userToken = registerData.token;
  console.log('Status:', register.status);
  console.log('Response:', JSON.stringify(registerData, null, 2));

  console.log('\n========== 4. GET ME ==========');
  const me = await fetch(`${BASE_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  console.log('Status:', me.status);
  console.log('Response:', JSON.stringify(await me.json(), null, 2));

  console.log('\n========== 5. ADMIN DASHBOARD ==========');
  const dashboard = await fetch(`${BASE_URL}/admin/dashboard`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log('Status:', dashboard.status);
  console.log('Response:', JSON.stringify(await dashboard.json(), null, 2));

  console.log('\n========== 6. CREATE MATCH ==========');
  const createMatch = await fetch(`${BASE_URL}/matches`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      title: 'Test Match 1',
      game: 'BGMI',
      entryFee: 50,
      maxPlayers: 2,
      startTime: '2026-12-01T10:00:00.000Z',
    }),
  });
  const matchData = await createMatch.json();
  console.log('Status:', createMatch.status);
  console.log('Response:', JSON.stringify(matchData, null, 2));

  console.log('\n========== 6b. JOIN MATCH AS USER ==========');
  // First login as testplayer1
  const userLoginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      email: 'testplayer1@example.com', 
      password: 'test1234' 
    }),
  });
  const userLoginData = await userLoginRes.json();
  const playerToken = userLoginData.accessToken || userLoginData.token;
  console.log('Player login status:', userLoginRes.status);

  // Create order for the quick match
  // Use the matchId from step 6 or hardcode a known UPCOMING matchId
  const knownMatchId = matchData.match?._id || 'PASTE_UPCOMING_MATCH_ID_HERE';

  const orderRes = await fetch(`${BASE_URL}/payment/create-order`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${playerToken}`
    },
    body: JSON.stringify({ matchId: knownMatchId }),
  });
  const orderData = await orderRes.json();
  console.log('Order status:', orderRes.status);
  console.log('Order:', JSON.stringify(orderData, null, 2));

  console.log('\n========== 7. GET ALL MATCHES ==========');
  const matches = await fetch(`${BASE_URL}/matches`);
  console.log('Status:', matches.status);
  console.log('Response:', JSON.stringify(await matches.json(), null, 2));

  console.log('\n========== 8. LEADERBOARD ==========');
  const leaderboard = await fetch(`${BASE_URL}/leaderboard/global`);
  console.log('Status:', leaderboard.status);
  console.log('Response:', JSON.stringify(await leaderboard.json(), null, 2));

  console.log('\n========== 9. PLAYER PROFILE ==========');
  const player = await fetch(`${BASE_URL}/player/me`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  console.log('Status:', player.status);
  console.log('Response:', JSON.stringify(await player.json(), null, 2));

  console.log('\n========== 10. WALLET ==========');
  const wallet = await fetch(`${BASE_URL}/wallet/me`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  console.log('Status:', wallet.status);
  console.log('Response:', JSON.stringify(await wallet.json(), null, 2));

  console.log('\n✅ ALL TESTS DONE!');
};

test().catch(console.error);
