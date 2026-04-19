const BASE_URL = 'http://127.0.0.1:5000';

async function run() {
  try {
    const loginRes = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@battlenix.com', password: 'admin123' }),
    });
    const loginData = await loginRes.json();
    console.log('Login response:', JSON.stringify(loginData, null, 2));
    const { accessToken, token } = loginData;
    const useToken = accessToken || token;
    console.log('Logged in, token:', useToken);

    const orderRes = await fetch(`${BASE_URL}/payment/create-order`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${useToken}`
      },
      body: JSON.stringify({ matchId: 'invalid_match_id' }),
    });
    const orderData = await orderRes.json();
    console.log('Order status:', orderRes.status);
    console.log('Order response:', JSON.stringify(orderData, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
