const API = 'http://localhost:8000/api/posts';
const THEME_KEY = 'wall-theme';
const THEMES = new Set(['sky', 'forest', 'sunset']);

async function requestJson(url, options = {}) {
    const res = await fetch(url, {
        credentials: 'include',
        ...options,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `request failed (${res.status})`);
    }
    return data;
}

function renderPosts(posts) {
    const list = document.getElementById('list');
    const totalCount = document.getElementById('total-count');
    if (totalCount) totalCount.textContent = `树洞 ${posts.length} 条`;
    list.innerHTML = '';
    if (!posts.length) {
        const li = document.createElement('li');
        li.className = 'post post-empty';
        li.textContent = '还没有内容，发第一条树洞吧。';
        list.appendChild(li);
        return;
    }

    posts.forEach((post, idx) => {
        const li = document.createElement('li');
        const text = document.createElement('p');
        const footer = document.createElement('div');
        const meta = document.createElement('div');
        const who = document.createElement('span');
        const time = document.createElement('span');
        const count = document.createElement('span');
        const actions = document.createElement('div');
        const likeBtn = document.createElement('button');
        const unlikeBtn = document.createElement('button');

        li.className = 'post';
        li.style.setProperty('--i', String(idx));
        text.className = 'post-text';
        footer.className = 'post-footer';
        meta.className = 'post-meta';
        who.className = `who ${post.isMine ? 'who-me' : 'who-other'}`;
        time.className = 'time';
        count.className = 'like-count';
        actions.className = 'actions';
        likeBtn.className = 'btn-like';
        unlikeBtn.className = 'btn-unlike';
        text.textContent = post.text;
        who.textContent = post.isMine ? '本人' : '陌生人';
        time.textContent = formatRelativeTime(post.createdAt);
        count.textContent = `👍 ${post.likes}`;
        likeBtn.textContent = '点赞';
        unlikeBtn.textContent = '取消点赞';
        applyLikeVisualState(likeBtn, unlikeBtn, post.likedByMe);

        likeBtn.addEventListener('click', () => like(post.id, count, likeBtn, unlikeBtn));
        unlikeBtn.addEventListener('click', () => unlike(post.id, count, likeBtn, unlikeBtn));

        meta.append(who, time, count);
        actions.append(likeBtn, unlikeBtn);
        footer.append(meta, actions);
        li.append(text, footer);
        list.appendChild(li);
    });
}

function setTheme(theme) {
    const t = THEMES.has(theme) ? theme : 'sky';
    if (t === 'sky') document.body.removeAttribute('data-theme');
    else document.body.setAttribute('data-theme', t);

    document.querySelectorAll('[data-theme-option]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.themeOption === t);
    });
    localStorage.setItem(THEME_KEY, t);
}

function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'sky';
    setTheme(saved);
    document.querySelectorAll('[data-theme-option]').forEach((btn) => {
        btn.addEventListener('click', () => setTheme(btn.dataset.themeOption));
    });
}

function applyLikeVisualState(likeBtn, unlikeBtn, likedByMe) {
    likeBtn.classList.toggle('is-liked', Boolean(likedByMe));
    unlikeBtn.disabled = !likedByMe;
}

function setLikeLoadingState(likeBtn, unlikeBtn, loading) {
    likeBtn.disabled = loading;
    unlikeBtn.disabled = loading || unlikeBtn.disabled;
    likeBtn.classList.toggle('is-loading', loading);
    unlikeBtn.classList.toggle('is-loading', loading);
}

function formatRelativeTime(input) {
    if (!input) return '刚刚';
    const ts = new Date(input).getTime();
    if (!Number.isFinite(ts)) return '刚刚';

    const diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return `${diffSec}秒前`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
    if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}天前`;
    return new Date(ts).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

/* -------- 点赞 -------- */
async function like(id, count, likeBtn, unlikeBtn) {
    setLikeLoadingState(likeBtn, unlikeBtn, true);
    try {
        const data = await requestJson(`${API}/${id}/like`, { method: 'POST' });
        count.textContent = `👍 ${data.likes}`;
        applyLikeVisualState(likeBtn, unlikeBtn, data.likedByMe);
    } catch (err) {
        alert(`点赞失败: ${err.message}`);
    } finally {
        setLikeLoadingState(likeBtn, unlikeBtn, false);
        applyLikeVisualState(likeBtn, unlikeBtn, likeBtn.classList.contains('is-liked'));
    }
}

/* -------- 取消点赞 -------- */
async function unlike(id, count, likeBtn, unlikeBtn) {
    setLikeLoadingState(likeBtn, unlikeBtn, true);
    try {
        const data = await requestJson(`${API}/${id}/like`, { method: 'DELETE' });
        count.textContent = `👍 ${data.likes}`;
        applyLikeVisualState(likeBtn, unlikeBtn, data.likedByMe);
    } catch (err) {
        alert(`取消点赞失败: ${err.message}`);
    } finally {
        setLikeLoadingState(likeBtn, unlikeBtn, false);
        applyLikeVisualState(likeBtn, unlikeBtn, likeBtn.classList.contains('is-liked'));
    }
}

/* -------- 加载列表（带排序） -------- */
async function load() {
    try {
        const sort = document.getElementById('sort')?.value || 'time';
        const url = sort === 'hot' ? `${API}?sort=hot` : API;
        const arr = await requestJson(url);
        renderPosts(arr);
    } catch (err) {
        alert(`加载失败: ${err.message}`);
    }
}

/* -------- 发布 -------- */
async function publish() {
    const text = document.getElementById('text').value.trim();
    if (!text) return alert('内容不能为空');
    try {
        await requestJson(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        document.getElementById('text').value = '';
        await load();
    } catch (err) {
        alert(`发布失败: ${err.message}`);
    }
}

/* -------- 首次加载 -------- */
initTheme();
load();
