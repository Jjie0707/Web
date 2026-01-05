const API = 'http://localhost:8000/api/posts';

/* -------- 点赞 -------- */
async function like(id, btn) {
    const res = await fetch(`${API}/${id}/like`, { method: 'POST' });
    const data = await res.json();
    btn.textContent = `👍 ${data.likes}`;
}

/* -------- 加载列表（带排序） -------- */
async function load() {
    const sort = document.getElementById('sort')?.value || 'time';
    const url = sort === 'hot' ? `${API}?sort=hot` : API;
    const res = await fetch(url);
    const arr = await res.json();
    const html = arr.map(p => `
    <li>
      <span>${p.text}</span>
      <button onclick="like(${p.id},this)">👍 ${p.likes}</button>
    </li>`).join('');
    document.getElementById('list').innerHTML = html;
}

/* -------- 发布 -------- */
async function publish() {
    const text = document.getElementById('text').value.trim();
    if (!text) return alert('内容不能为空');
    await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    document.getElementById('text').value = '';
    load();
}

/* -------- 首次加载 -------- */
load();