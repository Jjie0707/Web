const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const { v4: uuid } = require('uuid');

const app = express();
const PORT = 8000;
const DB_POSTS = path.join(__dirname, 'posts.json');
const DB_LIKE  = path.join(__dirname, 'likes.json');   // 点赞记录
const DB_CMT   = path.join(__dirname, 'comments.json');// 评论

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
const cors = require('cors');
app.use(cors());
if (!fs.existsSync(DB_POSTS)) fs.writeFileSync(DB_POSTS, '[]');
if (!fs.existsSync(DB_LIKE))  fs.writeFileSync(DB_LIKE, '{}');
if (!fs.existsSync(DB_CMT))   fs.writeFileSync(DB_CMT, '[]');

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

/* 3. 删自己贴 */
app.delete('/api/posts/:id', anon, (req, res) => {
    const posts = read(DB_POSTS);
    const idx = posts.findIndex(p => p.id === Number(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'not found' });
    if (posts[idx].anonId !== req.anonId) return res.status(403).json({ error: 'not yours' });
    posts.splice(idx, 1); write(DB_POSTS, posts);
    res.json({ ok: true });
});

/* 4. 点赞/取消点赞（防刷） */
app.post('/api/posts/:id/like', anon, (req, res) => {
    const pid = Number(req.params.id);
    const likes = read(DB_LIKE);               // 结构 { [post_anon]: 1 }
    const key = `${pid}_${req.anonId}`;
    const posts = read(DB_POSTS);
    const p = posts.find(pp => pp.id === pid);
    if (!p) return res.status(404).json({ error: 'post not found' });

    if (likes[key]) {          // 已赞 → 取消
        delete likes[key]; p.likes = Math.max(0, p.likes - 1);
    } else {                   // 未赞 → 加赞
        likes[key] = 1; p.likes++;
    }
    write(DB_LIKE, likes); write(DB_POSTS, posts);
    res.json({ likes: p.likes });
});

/* 5. 评论 */
app.post('/api/posts/:id/comment', anon, (req, res) => {
    const pid = Number(req.params.id);
    const text = (req.body.text || '').trim().slice(0, 500);
    if (!text) return res.status(400).json({ error: 'text required' });
    const cmts = read(DB_CMT);
    const c = { id: Date.now(), postId: pid, anonId: req.anonId, text, createdAt: new Date().toISOString() };
    cmts.unshift(c); write(DB_CMT, cmts);
    res.json({ id: c.id, text: c.text });
});


/* 6. 拿某贴评论 */
app.get('/api/posts/:id/comments', (req, res) => {
    const pid = Number(req.params.id);
    const cmts = read(DB_CMT).filter(c => c.postId === pid);
    res.json(cmts.map(c => ({ id: c.id, text: c.text, createdAt: c.createdAt })));
});

app.listen(PORT, () => console.log(`Backend ready at http://localhost:${PORT}`));