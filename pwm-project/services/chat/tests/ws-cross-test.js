const WebSocket = require('ws');

const baseUrl = process.env.GATEWAY_URL || 'http://app-route:3001';
const matchId = process.env.MATCH_ID || '9isOxm0XZ0';
const tokenA = process.env.TOKEN_A; // sender
const tokenB = process.env.TOKEN_B; // listener

if (!tokenA || !tokenB) {
  console.error('TOKEN_A and TOKEN_B env vars required');
  process.exit(1);
}

const wsUrl = (u) => u.replace(/^http/, 'ws') + `/chat/${matchId}`;

const payload = {
  tipo: 2,
  destinatario: 'ALL',
  content: `cross-test-${Date.now()}-${Math.random().toString(16).slice(2,6)}`,
};

const run = async () => {
  console.log('[CROSS] listener connecting...');
  const listener = new WebSocket(wsUrl(baseUrl), { headers: { Authorization: `Bearer ${tokenB}` } });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Listener connect timeout')), 10000);
    listener.on('open', () => { clearTimeout(timeout); resolve(); });
    listener.on('error', (e) => reject(e));
  });

  console.log('[CROSS] sender connecting...');
  const sender = new WebSocket(wsUrl(baseUrl), { headers: { Authorization: `Bearer ${tokenA}` } });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Sender connect timeout')), 10000);
    sender.on('open', () => { clearTimeout(timeout); resolve(); });
    sender.on('error', (e) => reject(e));
  });

  console.log('[CROSS] sender open, sending payload:', payload.content);
  sender.send(JSON.stringify(payload));

  const waitFor = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Listener timeout waiting for message')), 10000);
    listener.on('message', (m) => {
      try {
        const data = JSON.parse(m.toString());
        if (data?.type === 'NEW_MESSAGE' && data?.data?.content === payload.content) {
          clearTimeout(timer);
          resolve(data);
        }
      } catch (e) {}
    });
    listener.on('error', (e) => { clearTimeout(timer); reject(e); });
  });

  try {
    const msg = await waitFor;
    console.log('[CROSS] Listener received message:', msg.data.id_mex || msg.data.content);
    sender.close();
    listener.close();
    process.exit(0);
  } catch (error) {
    console.error('[CROSS] Error:', error.message);
    sender.close();
    listener.close();
    process.exit(1);
  }
};

run().catch((e) => { console.error(e); process.exit(1); });
