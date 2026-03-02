const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wall-api-'));
const postsFile = path.join(tempDir, 'posts.json');
const likesFile = path.join(tempDir, 'likes.json');

fs.writeFileSync(postsFile, '[]');
fs.writeFileSync(likesFile, '{}');

process.env.DB_POSTS_FILE = postsFile;
process.env.DB_LIKES_FILE = likesFile;
process.env.CORS_ORIGINS = 'http://localhost:3000';
process.env.POST_LIMIT_WINDOW_MS = '60000';
process.env.POST_LIMIT_MAX = '3';
process.env.LIKE_LIMIT_WINDOW_MS = '60000';
process.env.LIKE_LIMIT_MAX = '4';

const { createApp } = require('../backend/server');

let server;
let baseUrl;

function url(p) {
  return `${baseUrl}${p}`;
}

test.before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const addr = server.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('POST /api/posts creates post with string id', async () => {
  const res = await fetch(url('/api/posts'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ text: 'hello wall' }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.id, 'string');
  assert.equal(body.text, 'hello wall');
});

test('POST /api/posts/:id/like and DELETE /api/posts/:id/like work as split actions', async () => {
  const create = await fetch(url('/api/posts'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ text: 'for-like-test' }),
  });
  const created = await create.json();
  const cookie = create.headers.get('set-cookie');

  assert.ok(cookie);

  const like1 = await fetch(url(`/api/posts/${created.id}/like`), {
    method: 'POST',
    headers: {
      cookie,
      origin: 'http://localhost:3000',
    },
  });
  assert.equal(like1.status, 200);
  const body1 = await like1.json();
  assert.equal(body1.likes, 1);

  const like2 = await fetch(url(`/api/posts/${created.id}/like`), {
    method: 'DELETE',
    headers: {
      cookie,
      origin: 'http://localhost:3000',
    },
  });
  assert.equal(like2.status, 200);
  const body2 = await like2.json();
  assert.equal(body2.likes, 0);
  assert.equal(body2.likedByMe, false);
});

test('GET /api/posts returns likedByMe for current cookie', async () => {
  const create = await fetch(url('/api/posts'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ text: 'liked-state-test' }),
  });
  const created = await create.json();
  const cookie = create.headers.get('set-cookie');

  await fetch(url(`/api/posts/${created.id}/like`), {
    method: 'POST',
    headers: {
      cookie,
      origin: 'http://localhost:3000',
    },
  });

  const list = await fetch(url('/api/posts'), {
    method: 'GET',
    headers: {
      cookie,
      origin: 'http://localhost:3000',
    },
  });
  assert.equal(list.status, 200);
  const posts = await list.json();
  const target = posts.find((p) => p.id === created.id);
  assert.ok(target);
  assert.equal(target.likedByMe, true);
  assert.equal(target.isMine, true);
});

test('legacy numeric like key is recognized and normalized', async () => {
  const bootstrap = await fetch(url('/api/posts'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ text: 'cookie-bootstrap' }),
  });
  const cookie = bootstrap.headers.get('set-cookie');
  const anonId = cookie.split(';')[0].split('=')[1];
  const legacyPostId = 1765782253775;

  const postsRaw = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
  postsRaw.unshift({
    id: legacyPostId,
    anonId,
    text: 'legacy-like-key',
    likes: 1,
    createdAt: new Date().toISOString(),
  });
  fs.writeFileSync(postsFile, JSON.stringify(postsRaw, null, 2));

  const likesRaw = JSON.parse(fs.readFileSync(likesFile, 'utf8'));
  likesRaw[`${legacyPostId}_${anonId}`] = 1;
  fs.writeFileSync(likesFile, JSON.stringify(likesRaw, null, 2));

  const list = await fetch(url('/api/posts'), {
    method: 'GET',
    headers: {
      cookie,
      origin: 'http://localhost:3000',
    },
  });
  const posts = await list.json();
  const target = posts.find((p) => p.id === legacyPostId);
  assert.ok(target);
  assert.equal(target.likedByMe, true);
});

test('CORS rejects unknown origins', async () => {
  const res = await fetch(url('/api/posts'), {
    method: 'GET',
    headers: {
      origin: 'http://evil.local',
    },
  });

  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'cors denied');
});

test('POST /api/posts masks sensitive words', async () => {
  const create = await fetch(url('/api/posts'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ text: '你是傻逼' }),
  });
  assert.equal(create.status, 200);

  const list = await fetch(url('/api/posts'), {
    method: 'GET',
    headers: {
      origin: 'http://localhost:3000',
    },
  });
  const posts = await list.json();
  assert.ok(posts[0].text.includes('你是'));
  assert.equal(posts[0].text.includes('傻逼'), false);
});

test('POST /api/posts rate limit returns 429', async () => {
  const seed = await fetch(url('/api/posts'), {
    method: 'GET',
    headers: { origin: 'http://localhost:3000' },
  });
  const cookie = seed.headers.get('set-cookie');
  assert.ok(cookie);

  for (let i = 0; i < 3; i += 1) {
    const ok = await fetch(url('/api/posts'), {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
      },
      body: JSON.stringify({ text: `rate-limit-${i}` }),
    });
    assert.equal(ok.status, 200);
  }

  const blocked = await fetch(url('/api/posts'), {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ text: 'rate-limit-blocked' }),
  });
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error, 'post rate limit exceeded');
});

test('like endpoints rate limit returns 429', async () => {
  const create = await fetch(url('/api/posts'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ text: 'like-limit-seed' }),
  });
  const created = await create.json();
  const cookie = create.headers.get('set-cookie');
  assert.ok(cookie);

  const methods = ['POST', 'DELETE', 'POST', 'DELETE'];
  for (const method of methods) {
    const ok = await fetch(url(`/api/posts/${created.id}/like`), {
      method,
      headers: {
        cookie,
        origin: 'http://localhost:3000',
      },
    });
    assert.equal(ok.status, 200);
  }

  const blocked = await fetch(url(`/api/posts/${created.id}/like`), {
    method: 'POST',
    headers: {
      cookie,
      origin: 'http://localhost:3000',
    },
  });
  assert.equal(blocked.status, 429);
  const body = await blocked.json();
  assert.equal(body.error, 'like rate limit exceeded');
});
