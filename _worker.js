// xread — X 公开帖子只读中继：服务端抓取公开镜像接口，整理成纯文本，
// 让任何网页抓取器（包括 ChatGPT）只打开一个普通链接就能读到全文。
// 只读公开数据；不登录、不使用 Cookie、不执行任何社交操作。
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const raw = url.searchParams.get('url') || '';
    let user = url.searchParams.get('u') || '';
    let id = url.searchParams.get('id') || '';
    if (raw) {
      const m = raw.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/);
      if (m) { user = m[1]; id = m[2]; }
    }
    const help = [
      'xread — X 公开帖子全文读取（只读）',
      '用法一：' + url.origin + '/?url=<X帖子链接>',
      '用法二：' + url.origin + '/?u=<用户名>&id=<帖子ID>',
      '返回纯文本：普通帖返回正文；长文返回标题 + 全文。'
    ].join('\n');
    const text = (body, status) => new Response(body, { status: status || 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    if (!/^[A-Za-z0-9_]{1,15}$/.test(user) || !/^\d{5,25}$/.test(id)) {
      return text(help, (raw || user || id) ? 400 : 200);
    }
    const H = { 'user-agent': 'Mozilla/5.0 (compatible; xread/1.0)' };
    let t = null, src = '';
    try {
      const r = await fetch('https://api.fxtwitter.com/' + user + '/status/' + id, { headers: H });
      if (r.ok) { const j = await r.json(); if (j && j.tweet) { t = j.tweet; src = 'fxtwitter'; } }
    } catch (e) { /* fall through to backup */ }
    let vx = null;
    if (!t || !t.article) {
      try {
        const r2 = await fetch('https://api.vxtwitter.com/' + user + '/status/' + id, { headers: H });
        if (r2.ok) vx = await r2.json();
      } catch (e) { /* ignore */ }
    }
    if (!t && !vx) return text('读取失败：两个公开接口暂时都不可用，请稍后再试。', 502);
    const lines = [];
    const author = t && t.author ? '@' + t.author.screen_name + '（' + t.author.name + '，粉丝 ' + t.author.followers + '）'
      : (vx ? '@' + vx.user_screen_name + '（' + vx.user_name + '）' : '@' + user);
    lines.push('原帖：https://x.com/' + user + '/status/' + id);
    lines.push('作者：' + author);
    if (t && t.created_at) lines.push('发帖时间：' + t.created_at);
    if (t && t.views !== undefined) lines.push('数据：浏览 ' + t.views + ' · 点赞 ' + t.likes + ' · 收藏 ' + t.bookmarks + ' · 回复 ' + t.replies + ' · 转发 ' + t.retweets);
    else if (vx) lines.push('数据：点赞 ' + vx.likes + ' · 回复 ' + vx.replies + ' · 转发 ' + vx.retweets);
    lines.push('');
    if (t && t.article && t.article.content && Array.isArray(t.article.content.blocks)) {
      if (t.article.title) { lines.push('【长文】' + t.article.title); lines.push(''); }
      for (const b of t.article.content.blocks) {
        const s = (b && b.text ? String(b.text) : '').trim();
        if (s) lines.push(s, '');
      }
    } else if (t && t.text && !/^https:\/\/x\.com\/i\/article\//.test(t.text)) {
      lines.push(t.text);
    } else if (vx) {
      if (vx.article && vx.article.title) { lines.push('【长文】' + vx.article.title); lines.push(''); }
      if (vx.text && !/^https:\/\/x\.com\/i\/article\//.test(vx.text)) lines.push(vx.text);
      if (vx.article && vx.article.preview_text) { lines.push(''); lines.push('（备用接口仅提供预览）'); lines.push(vx.article.preview_text); }
    }
    lines.push('');
    lines.push('（来源：' + (src || 'vxtwitter') + ' 公开只读接口，经 xread 中继整理；数据为抓取时点值）');
    return text(lines.join('\n'));
  }
};
