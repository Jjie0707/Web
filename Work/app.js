const API = 'http://localhost:8000/api/posts';

async function load(){
    const res = await fetch(API);
    const arr = await res.json();
    const html = arr.map(p=>`<li>${p.text}</li>`).join('');
    document.getElementById('list').innerHTML = html;
}
async function publish(){
    const text = document.getElementById('text').value.trim();
    if(!text) return alert('内容不能为空');
    await fetch(API,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text})
    });
    document.getElementById('text').value='';
    load();          // 重新拉列表
}
load();