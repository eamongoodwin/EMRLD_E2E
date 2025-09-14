// worker.js — serve static assets + JSON API (with Turnstile)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS / preflight
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // ---------------- API ----------------
    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname === '/api/health') {
          return json({ status: 'healthy', ts: Date.now(), service: 'emerald-city' }, cors);
        }

        // Turnstile verification endpoint
        if (url.pathname === '/api/turnstile/verify' && request.method === 'POST') {
          // Accept either form-data, urlencoded, or JSON and normalize to a token
          const ct = request.headers.get('content-type') || '';
          let token = '';
          if (ct.includes('application/json')) {
            const j = await request.json().catch(() => ({}));
            token = j['cf-turnstile-response'] || j['token'] || '';
          } else if (ct.includes('application/x-www-form-urlencoded')) {
            const p = new URLSearchParams(await request.text());
            token = p.get('cf-turnstile-response') || p.get('token') || '';
          } else {
            const f = await request.formData().catch(() => null);
            token = f?.get('cf-turnstile-response') || f?.get('token') || '';
          }
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: new URLSearchParams({
              secret: env.TURNSTILE_SECRET,
              response: token,
              remoteip: ip
            })
          });
          const data = await verify.json();
          // Inspect in Logs / `wrangler tail`
          console.log('turnstile verify', JSON.stringify(data));
          return new Response(JSON.stringify(data), {
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors }
          });
        }

        if (url.pathname === '/api/room/create' && request.method === 'POST') {
          const { roomName, password, token } = await request.json();

          // Turnstile verification bypassed for testing
          console.log('Room creation - Turnstile verification bypassed for testing');

          const roomId = await createRoom(env.MESSENGER_KV, roomName, password);
          return json({ success: true, roomId, roomName }, cors);
        }

        if (url.pathname === '/api/room/join' && request.method === 'POST') {
          const { roomId, password, token } = await request.json();

          // Turnstile verification bypassed for testing
          console.log('Room join - Turnstile verification bypassed for testing');

          const room = await joinRoom(env.MESSENGER_KV, roomId, password);
          return json({ success: true, room }, cors);
        }

        if (url.pathname === '/api/message/send' && request.method === 'POST') {
          const { roomId, message, senderName } = await request.json();
          const result = await sendMessage(env.MESSENGER_KV, roomId, message, senderName);
          return json(result, cors);
        }

        if (url.pathname.startsWith('/api/room/') && url.pathname.endsWith('/messages')) {
          const roomId = url.pathname.split('/')[3];
          const messages = await getMessages(env.MESSENGER_KV, roomId);
          return json({ success: true, messages }, cors);
        }

        if (url.pathname.startsWith('/api/room/') && request.method === 'DELETE') {
          const roomId = url.pathname.split('/')[3];
          const { adminPassword } = await request.json();
          const result = await deleteRoom(env.MESSENGER_KV, roomId, adminPassword);
          return json(result, cors);
        }

        return json({ success: false, error: 'Not Found' }, cors, 404);
      } catch (err) {
        return json({ success: false, error: String(err?.message || err) }, cors, 500);
      }
    }

    // ------------- Static assets -------------
    // Requires: [assets] directory in wrangler.toml
    if (env.ASSETS) {
      // exact asset first
      const res = await env.ASSETS.fetch(request);
      if (res.status !== 404) return res;

      // SPA fallback
      if (acceptsHtml(request) && request.method === 'GET') {
        const indexReq = new Request(new URL('/index.html', request.url), request);
        const indexRes = await env.ASSETS.fetch(indexReq);
        if (indexRes.status !== 404) return indexRes;
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};

/* ----------------- Turnstile (disabled for testing) ----------------- */
async function verifyTurnstile(env, token, ip) {
  // Bypass Turnstile verification for testing
  console.log('Turnstile verification bypassed for testing - token:', token?.substring(0, 20) + '...');
  return true; // Always return true for testing
}

/* ----------------- Storage & Crypto (unchanged) ----------------- */

async function createRoom(kv, roomName, password) {
  const roomId = 'emerald_' + crypto.randomUUID().substring(0, 8);
  const roomData = {
    id: roomId,
    name: roomName,
    created: Date.now(),
    adminPassword: await hashPassword(password),
    messageCount: 0
  };
  await kv.put(`room:${roomId}`, JSON.stringify(roomData));
  await kv.put(`room:${roomId}:messages`, JSON.stringify([]));
  return roomId;
}

async function joinRoom(kv, roomId, password) {
  const raw = await kv.get(`room:${roomId}`);
  if (!raw) throw new Error('Room not found');
  const room = JSON.parse(raw);
  const ok = await verifyPassword(password, room.adminPassword);
  if (!ok) throw new Error('Invalid room password');
  return { id: room.id, name: room.name, messageCount: room.messageCount };
}

async function sendMessage(kv, roomId, text, senderName) {
  const roomRaw = await kv.get(`room:${roomId}`);
  if (!roomRaw) throw new Error('Room not found');

  const enc = await encryptMessage(text, roomId);
  const message = {
    id: 'msg_' + crypto.randomUUID().substring(0, 12),
    sender: senderName,
    timestamp: Date.now(),
    encryptedData: enc.encryptedData,
    keyData: enc.keyData,
    algorithm: enc.metadata.algorithm
  };

  const msgsRaw = await kv.get(`room:${roomId}:messages`);
  const msgs = msgsRaw ? JSON.parse(msgsRaw) : [];
  msgs.push(message);
  if (msgs.length > 100) msgs.splice(0, msgs.length - 100);
  await kv.put(`room:${roomId}:messages`, JSON.stringify(msgs));

  const room = JSON.parse(roomRaw);
  room.messageCount = msgs.length;
  await kv.put(`room:${roomId}`, JSON.stringify(room));

  return { success: true, messageId: message.id, encryptedMessage: message };
}

async function getMessages(kv, roomId) {
  const msgsRaw = await kv.get(`room:${roomId}:messages`);
  return msgsRaw ? JSON.parse(msgsRaw) : [];
}

async function deleteRoom(kv, roomId, adminPassword) {
  const roomRaw = await kv.get(`room:${roomId}`);
  if (!roomRaw) throw new Error('Room not found');
  const room = JSON.parse(roomRaw);
  const ok = await verifyPassword(adminPassword, room.adminPassword);
  if (!ok) throw new Error('Invalid admin password');
  await kv.delete(`room:${roomId}`);
  await kv.delete(`room:${roomId}:messages`);
  return { success: true, message: 'Room deleted' };
}

/* ----------------- EMRLD-ish crypto helpers ----------------- */

async function encryptMessage(message, context = 'default') {
  let data = new TextEncoder().encode(message);
  const rounds = 3; // keep aligned with your current build
  for (let i = 0; i < rounds; i++) {
    const roundKey = await deriveKey(context + i, `round-${i}`);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, roundKey, data);
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    data = combined;
  }
  const quantumKey = await generateQuantumInspiredKey(256);
  const xorData = xorWithKey(data, quantumKey);
  return {
    success: true,
    encryptedData: toB64(xorData),
    keyData: toB64(quantumKey),
    metadata: { rounds, algorithm: 'EMRLD-Chain + QI-XOR', timestamp: Date.now() }
  };
}

async function deriveKey(password, salt) {
  const mat = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 10000, hash: 'SHA-256' },
    mat, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
}

async function generateQuantumInspiredKey(bits) {
  const bytes = bits / 8;
  const rnd = crypto.getRandomValues(new Uint8Array(bytes));
  for (let i = 0; i < rnd.length; i++) {
    rnd[i] ^= (i * 37) & 0xff;
    rnd[i] = ((rnd[i] * 41) + 17) & 0xff;
  }
  const hash = await crypto.subtle.digest('SHA-256', rnd.buffer);
  return new Uint8Array(hash);
}

function xorWithKey(data, key) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

/* ----------------- utils ----------------- */

function json(data, headers = {}, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

async function hashPassword(pw) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return toB64(new Uint8Array(hash));
}

async function verifyPassword(pw, hashed) {
  return (await hashPassword(pw)) === hashed;
}

function toB64(buf) {
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}

function acceptsHtml(req) {
  return (req.headers.get('Accept') || '').includes('text/html');
}
