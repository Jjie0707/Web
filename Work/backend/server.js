const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const { v4: uuid } = require('uuid');

const app = express();
const PORT = 8000;
const DB_POSTS = path.join(__dirname, 'posts.json');
const DB_LIKE = path.join(__dirname, 'likes.json');   // 点赞记录

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
const cors = require('cors');
app.use(cors());
if (!fs.existsSync(DB_POSTS)) fs.writeFileSync(DB_POSTS, '[]');
if (!fs.existsSync(DB_LIKE))  fs.writeFileSync(DB_LIKE, '{}');

const read = f => JSON.parse(fs.readFileSync(f, 'utf-8'));
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

function anon(req, res, next) {
    let id = req.cookies.anon_id;
    if (!id) { id = uuid().replace(/-/g, ''); res.cookie('anon_id', id, { maxAge: 365 * 24 * 3600 * 1000, httpOnly: true }); }
    req.anonId = id; next();
}

/* 1. 发贴 */
app.post('/api/posts', anon, (req, res) => {
    const text = (req.body.text || '').trim().slice(0, 2000);
    if (!text) return res.status(400).json({ error: 'text required' });
    const posts = read(DB_POSTS);
    const p = { id: Date.now(), anonId: req.anonId, text, likes: 0, createdAt: new Date().toISOString() };
    posts.unshift(p); write(DB_POSTS, posts);
    res.json({ id: p.id, text: p.text });
});

/* 2. 列表（支持排序） */
app.get('/api/posts', (req, res) => {
    let posts = read(DB_POSTS);
    if (req.query.sort === 'hot') posts = posts.sort((a, b) => b.likes - a.likes);
    res.json(posts.map(p => ({ id: p.id, text: p.text, likes: p.likes, createdAt: p.createdAt })));
});

/* 3. 点赞/取消点赞（防刷） */
app.post('/api/posts/:id/like', anon, (req, res) => {
    const pid = Number(req.params.id);
    const likes = read(DB_LIKE);
    const key = `${pid}_${req.anonId}`;
    const posts = read(DB_POSTS);
    const p = posts.find(pp => pp.id === pid);
    if (!p) return res.status(404).json({ error: 'post not found' });

    if (likes[key]) { delete likes[key]; p.likes = Math.max(0, p.likes - 1); }
    else { likes[key] = 1; p.likes++; }
    write(DB_LIKE, likes); write(DB_POSTS, posts);
    res.json({ likes: p.likes });
});

app.listen(PORT, () => console.log(`Backend ready at http://localhost:${PORT}`));