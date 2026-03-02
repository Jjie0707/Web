const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { v4: uuid } = require('uuid');

const PORT = Number(process.env.PORT || 8000);
const DB_POSTS = process.env.DB_POSTS_FILE || path.join(__dirname, 'posts.json');
const DB_LIKE = process.env.DB_LIKES_FILE || path.join(__dirname, 'likes.json');
const MAX_TEXT_LENGTH = 2000;
const POST_LIMIT_WINDOW_MS = Number(process.env.POST_LIMIT_WINDOW_MS || 60_000);
const POST_LIMIT_MAX = Number(process.env.POST_LIMIT_MAX || 6);
const LIKE_LIMIT_WINDOW_MS = Number(process.env.LIKE_LIMIT_WINDOW_MS || 10_000);
const LIKE_LIMIT_MAX = Number(process.env.LIKE_LIMIT_MAX || 20);

if (!fs.existsSync(DB_POSTS)) fs.writeFileSync(DB_POSTS, '[]');
if (!fs.existsSync(DB_LIKE)) fs.writeFileSync(DB_LIKE, '{}');

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf-8'));

function writeAtomic(file, data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

let writeQueue = Promise.resolve();
function withWriteLock(task) {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => undefined);
    return run;
}

function parseAllowedOrigins() {
    const envRaw = (process.env.CORS_ORIGINS || '').trim();
    if (envRaw === '*') {
        return { allowAll: true, exactOrigins: new Set() };
    }

    const defaults = ['http://localhost:5500', 'http://127.0.0.1:5500'];
    const envOrigins = envRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return { allowAll: false, exactOrigins: new Set([...defaults, ...envOrigins]) };
}

function createCorsOptions() {
    const allowed = parseAllowedOrigins();
    const localHostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
    return {
        credentials: true,
        origin(origin, cb) {
            // allow non-browser clients (curl, server-to-server)
            if (!origin) return cb(null, true);
            // allow local file preview: Origin header becomes "null"
            if (origin === 'null') return cb(null, true);
            if (allowed.allowAll) return cb(null, true);
            if (localHostPattern.test(origin)) return cb(null, true);
            if (allowed.exactOrigins.has(origin)) return cb(null, true);
            return cb(new Error('CORS origin denied'));
        },
    };
}

function anon(req, res, next) {
    let id = req.cookies.anon_id;
    if (!id) {
        id = uuid().replace(/-/g, '');
        res.cookie('anon_id', id, {
            maxAge: 365 * 24 * 3600 * 1000,
            httpOnly: true,
            sameSite: 'lax',
        });
    }
    req.anonId = id;
    next();
}

function createApp() {
    const app = express();
    const rateLimitState = new Map();

    app.use(express.json({ limit: '2mb' }));
    app.use(cookieParser());
    app.use(cors(createCorsOptions()));

    function parseSensitiveWords() {
        const defaults = ['傻逼', '傻x', '傻叉', '妈的', '操你妈', 'fuck', 'shit'];
        const custom = (process.env.SENSITIVE_WORDS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        return [...new Set([...defaults, ...custom])];
    }

    function escapeRegExp(input) {
        return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function maskWord(word) {
        const len = Array.from(word).length;
        return '*'.repeat(Math.max(2, len));
    }

    function sanitizeText(input) {
        let output = input;
        const words = parseSensitiveWords();
        words.forEach((word) => {
            const reg = new RegExp(escapeRegExp(word), 'gi');
            output = output.replace(reg, maskWord(word));
        });
        return output;
    }

    function getClientKey(req, action, scope = '') {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const anonId = req.anonId || req.cookies?.anon_id || 'guest';
        return `${action}:${scope}:${ip}:${anonId}`;
    }

    function hitRateLimit(req, action, options = {}) {
        const windowMs = options.windowMs;
        const maxHits = options.maxHits;
        const scope = options.scope || '';
        const now = Date.now();
        const key = getClientKey(req, action, scope);
        const entry = rateLimitState.get(key) || [];
        const valid = entry.filter((ts) => now - ts < windowMs);

        if (valid.length >= maxHits) {
            const oldest = valid[0];
            const retryAfterMs = Math.max(1_000, windowMs - (now - oldest));
            rateLimitState.set(key, valid);
            return { limited: true, retryAfterMs };
        }

        valid.push(now);
        rateLimitState.set(key, valid);
        return { limited: false, retryAfterMs: 0 };
    }

    function getLikeKeys(postId, anonId) {
        const raw = String(postId);
        const numeric = Number(postId);
        const keys = [`${raw}_${anonId}`];
        if (Number.isFinite(numeric)) {
            keys.push(`${numeric}_${anonId}`);
        }
        return [...new Set(keys)];
    }

    function hasLiked(likes, postId, anonId) {
        return getLikeKeys(postId, anonId).some((k) => Boolean(likes[k]));
    }

    app.post('/api/posts', anon, async (req, res) => {
        const postLimit = hitRateLimit(req, 'post', {
            windowMs: POST_LIMIT_WINDOW_MS,
            maxHits: POST_LIMIT_MAX,
        });
        if (postLimit.limited) {
            return res.status(429).json({
                error: 'post rate limit exceeded',
                retryAfterMs: postLimit.retryAfterMs,
            });
        }

        const rawText = String(req.body?.text || '').trim().slice(0, MAX_TEXT_LENGTH);
        const text = sanitizeText(rawText);
        if (!text) return res.status(400).json({ error: 'text required' });

        const post = {
            id: uuid().replace(/-/g, ''),
            anonId: req.anonId,
            text,
            likes: 0,
            createdAt: new Date().toISOString(),
        };

        await withWriteLock(async () => {
            const posts = read(DB_POSTS);
            posts.unshift(post);
            writeAtomic(DB_POSTS, posts);
        });

        return res.json({ id: post.id, text: post.text });
    });

    app.get('/api/posts', anon, (req, res) => {
        const posts = read(DB_POSTS);
        const likes = read(DB_LIKE);
        const sorted =
            req.query.sort === 'hot'
                ? [...posts].sort((a, b) => b.likes - a.likes)
                : posts;

        return res.json(
            sorted.map((p) => ({
                id: p.id,
                text: p.text,
                likes: p.likes,
                createdAt: p.createdAt,
                likedByMe: hasLiked(likes, p.id, req.anonId),
                isMine: String(p.anonId) === String(req.anonId),
            }))
        );
    });

    async function setLikeState(req, res, shouldLike) {
        const postId = String(req.params.id || '').trim();
        if (!postId) return res.status(400).json({ error: 'invalid post id' });
        const likeLimit = hitRateLimit(req, 'like', {
            windowMs: LIKE_LIMIT_WINDOW_MS,
            maxHits: LIKE_LIMIT_MAX,
            scope: postId,
        });
        if (likeLimit.limited) {
            return res.status(429).json({
                error: 'like rate limit exceeded',
                retryAfterMs: likeLimit.retryAfterMs,
            });
        }

        const result = await withWriteLock(async () => {
            const likes = read(DB_LIKE);
            const posts = read(DB_POSTS);
            const post = posts.find((p) => String(p.id) === postId);
            if (!post) return { status: 404, payload: { error: 'post not found' } };

            const normalizedPostId = String(post.id);
            const keys = getLikeKeys(normalizedPostId, req.anonId);
            const normalizedKey = `${normalizedPostId}_${req.anonId}`;
            const alreadyLiked = keys.some((k) => Boolean(likes[k]));

            if (shouldLike && !alreadyLiked) {
                likes[normalizedKey] = 1;
                post.likes += 1;
            }
            if (!shouldLike && alreadyLiked) {
                keys.forEach((k) => {
                    delete likes[k];
                });
                post.likes = Math.max(0, post.likes - 1);
            }
            if (shouldLike && alreadyLiked) {
                // Normalize legacy keys to current format without changing count.
                keys.forEach((k) => {
                    if (k !== normalizedKey) delete likes[k];
                });
                likes[normalizedKey] = 1;
            }

            writeAtomic(DB_LIKE, likes);
            writeAtomic(DB_POSTS, posts);

            return {
                status: 200,
                payload: { likes: post.likes, likedByMe: hasLiked(likes, normalizedPostId, req.anonId) },
            };
        });

        return res.status(result.status).json(result.payload);
    }

    app.post('/api/posts/:id/like', anon, async (req, res) => {
        return setLikeState(req, res, true);
    });

    app.delete('/api/posts/:id/like', anon, async (req, res) => {
        return setLikeState(req, res, false);
    });

    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        if (err?.message === 'CORS origin denied') {
            return res.status(403).json({ error: 'cors denied' });
        }
        console.error(err);
        return res.status(500).json({ error: 'internal server error' });
    });

    return app;
}

if (require.main === module) {
    const app = createApp();
    app.listen(PORT, () => {
        console.log(`Backend ready at http://localhost:${PORT}`);
    });
}

module.exports = { createApp };
