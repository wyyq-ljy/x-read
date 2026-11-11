// xread v2 — X 公开帖子只读中继。
// 三种消费方式：
// 1) GET /?url=<X链接> → 纯文本全文（人/普通抓取器）
// 2) GET /api/read?url=<X链接> → 结构化 JSON（Custom GPT Actions 等）
// 3) POST /mcp → MCP（ChatGPT 开发者模式自定义连接器）
// 只读公开数据；不登录、不使用 Cookie、不执行任何社交操作。
// 服务端只会请求由「用户名/帖子ID」拼出的 fxtwitter / vxtwitter 地址，
// 绝不抓取调用方给的任意 URL，因此不是开放代理。

const USER_RE = /^[A-Za-z0-9_]{1,15}$/;
const ID_RE = /^\d{5,25}$/;
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; xread/2.0)'};

function parseRef(rawUrl, u, i) {
let user = u || '', id = i || '';
if (rawUrl) {
const m = String(rawUrl).match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/)
|| String(rawUrl).match(/^@?([A-Za-z0-9_]{1,15})[/:](\d{5,25})$/);
if (m) { user = m[1]; id = m[2];}
}
if (USER_RE.test(user) && ID_RE.test(id)) return { user, id};
return null;
}

async function fetchPostRaw(user, id) {
let t = null, src = '';
try {
const r = await fetch('https://api.fxtwitter.com/' + user + '/status/' + id, { headers: UA});
if (r.ok) { const j = await r.json(); if (j && j.tweet) { t = j.tweet; src = 'fxtwitter';}}
} catch (e) { /* fall through */}
let vx = null;
if (!t ||!t.article) {
try {
const r2 = await fetch('https://api.vxtwitter.com/' + user + '/status/' + id, { headers: UA});
if (r2.ok) vx = await r2.json();
} catch (e) { /* ignore */}
}
if (!t &&!vx) return null;
const post = {
user, id,
url: 'https://x.com/' + user + '/status/' + id,
author_screen_name: user, author_name: '', followers: null,
created_at: null, views: null, likes: null, bookmarks: null, replies: null, retweets: null,
is_article: false, title: null, paragraphs: [], partial: false, source: src || 'vxtwitter'
};
if (t && t.author) {
post.author_screen_name = t.author.screen_name || user;
post.author_name = t.author.name || '';
post.followers = (typeof t.author.followers === 'number')? t.author.followers: null;
} else if (vx) {
post.author_screen_name = vx.user_screen_name || user;
post.author_name = vx.user_name || '';
}
if (t) {
post.created_at = t.created_at || null;
post.views = (t.views!== undefined)? t.views: null;
post.likes = (t.likes!== undefined)? t.likes: null;
post.bookmarks = (t.bookmarks!== undefined)? t.bookmarks: null;
post.replies = (t.replies!== undefined)? t.replies: null;
post.retweets = (t.retweets!== undefined)? t.retweets: null;
} else if (vx) {
post.likes = (vx.likes!== undefined)? vx.likes: null;
post.replies = (vx.replies!== undefined)? vx.replies: null;
post.retweets = (vx.retweets!== undefined)? vx.retweets: null;
}
if (t && t.article && t.article.content && Array.isArray(t.article.content.blocks)) {
post.is_article = true;
post.title = t.article.title || null;
for (const b of t.article.content.blocks) {
const s = (b && b.text? String(b.text): '').trim();
if (s) post.paragraphs.push({ type: (b && b.type) || 'unstyled', text: s});
}
} else if (t && t.text &&!/^https:\/\/x\.com\/i\/article\//.test(t.text)) {
post.paragraphs.push({ type: 'unstyled', text: t.text});
} else if (vx) {
if (vx.article && vx.article.title) { post.is_article = true; post.title = vx.article.title; post.partial = true;}
if (vx.text &&!/^https:\/\/x\.com\/i\/article\//.test(vx.text)) post.paragraphs.push({ type: 'unstyled', text: vx.text});
if (vx.article && vx.article.preview_text) post.paragraphs.push({ type: 'preview', text: vx.article.preview_text});
if (post.is_article) post.partial = true;
}
post.text = composeText(post);
return post;
}

function composeText(post) {
const lines = [];
const author = '@' + post.author_screen_name + '（' + post.author_name + (post.followers!== null? '，粉丝 ' + post.followers: '') + '）';
lines.push('原帖：' + post.url);
lines.push('作者：' + author);
if (post.created_at) lines.push('发帖时间：' + post.created_at);
if (post.views!== null) lines.push('数据：浏览 ' + post.views + ' · 点赞 ' + post.likes + ' · 收藏 ' + post.bookmarks + ' · 回复 ' + post.replies + ' · 转发 ' + post.retweets);
else if (post.likes!== null) lines.push('数据：点赞 ' + post.likes + ' · 回复 ' + post.replies + ' · 转发 ' + post.retweets);
lines.push('');
if (post.is_article && post.title) { lines.push('' + post.title); lines.push('');}
for (const p of post.paragraphs) {
if (p.type === 'preview') { lines.push('（备用接口仅提供预览）'); lines.push(p.text);}
else lines.push(p.text, '');
}
lines.push('（来源：' + post.source + ' 公开只读接口，经 xread 中继整理；数据为抓取时点值）');
return lines.join('\n');
}

// Post cache via Cache API (600s) — cuts upstream calls and latency.
async function getPost(user, id) {
const key = new Request('https://cache.xread.internal/post/' + user + '/' + id);
try {
const hit = await caches.default.match(key);
if (hit) return await hit.json();
} catch (e) { /* cache optional */}
const post = await fetchPostRaw(user, id);
if (post) {
try {
const resp = new Response(JSON.stringify(post), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=600'}});
await caches.default.put(key, resp);
} catch (e) { /* ignore */}
}
return post;
}

// Best-effort per-IP fixed-window rate limit (per isolate): 120 req / 10 min.
const rlMap = new Map();
function rateLimited(request) {
const ip = request.headers.get('cf-connecting-ip') || 'unknown';
const now = Date.now();
const win = Math.floor(now / 600000);
const k = ip + ':' + win;
const n = (rlMap.get(k) || 0) + 1;
rlMap.set(k, n);
if (rlMap.size > 5000) rlMap.clear();
return n > 120;
}

const json = (obj, status) => new Response(JSON.stringify(obj), {
status: status || 200,
headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*'}
});

// ---------------- MCP (stateless Streamable HTTP, JSON-RPC 2.0) ----------------
const TOOLS = [
{
name: 'read_x_post',
title: 'Read X post (full text)',
description: '读取一条公开 X（Twitter）帖子或 X 长文的完整全文。给出 url（帖子链接），或 user + id。返回作者、标题、正文全文与互动数据。Use whenever the user shares an X/Twitter post link and wants its content read, summarized or commented on. Read-only, public posts only.',
inputSchema: {
type: 'object',
properties: {
url: { type: 'string', description: 'X post URL, e.g. https://x.com/<user>/status/<id>'},
user: { type: 'string', description: 'Author screen name (without @). Alternative to url.'},
id: { type: 'string', description: 'Numeric post/status id. Alternative to url.'}
}
},
annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true}
},
{
name: 'search',
title: 'Find an X post by link',
description: 'Deep-research style search: pass an X post URL (or @user/status id) as the query; returns the matching post as a fetchable result with id, title and url.',
inputSchema: { type: 'object', properties: { query: { type: 'string'}}, required: ['query']},
annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true}
},
{
name: 'fetch',
title: 'Fetch an X post document',
description: 'Fetch the full document of a public X post. id is the canonical post URL returned by search (or any x.com/<user>/status/<id> URL). Returns id, title, full text, url and metadata.',
inputSchema: { type: 'object', properties: { id: { type: 'string'}}, required: ['id']},
annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true}
}
];

async function toolCall(name, args) {
args = args || {};
if (name === 'read_x_post') {
const ref = parseRef(args.url, args.user, args.id);
if (!ref) return { isError: true, text: '参数无效：请提供帖子链接 url，或 user + id。'};
const post = await getPost(ref.user, ref.id);
if (!post) return { isError: true, text: '读取失败：公开接口暂时不可用，或帖子不存在/不可见。'};
return {
text: post.text,
structured: {
id: post.url, url: post.url, title: post.title || '',
author: '@' + post.author_screen_name + (post.author_name? '（' + post.author_name + '）': ''),
created_at: post.created_at, is_article: post.is_article, partial: post.partial,
stats: { views: post.views, likes: post.likes, bookmarks: post.bookmarks, replies: post.replies, retweets: post.retweets},
paragraphs: post.paragraphs, text: post.text
}
};
}
if (name === 'search') {
const ref = parseRef(args.query, '', '');
if (!ref) return { structured: { results: []}, text: JSON.stringify({ results: []})};
const post = await getPost(ref.user, ref.id);
if (!post) return { structured: { results: []}, text: JSON.stringify({ results: []})};
const title = post.title || ('@' + post.author_screen_name + ' 的帖子 ' + post.id);
const results = [{ id: post.url, title, url: post.url}];
return { structured: { results}, text: JSON.stringify({ results})};
}
if (name === 'fetch') {
const ref = parseRef(args.id, '', '');
if (!ref) return { isError: true, text: 'id 无效：应为帖子链接（含 /<user>/status/<id>）。'};
const post = await getPost(ref.user, ref.id);
if (!post) return { isError: true, text: '读取失败：公开接口暂时不可用，或帖子不存在/不可见。'};
const doc = {
id: post.url, title: post.title || ('@' + post.author_screen_name + ' 的帖子'), text: post.text, url: post.url,
metadata: {
author: '@' + post.author_screen_name, author_name: post.author_name, followers: post.followers,
created_at: post.created_at, is_article: post.is_article, partial: post.partial,
views: post.views, likes: post.likes, bookmarks: post.bookmarks, replies: post.replies, retweets: post.retweets,
source: post.source
}
};
return { structured: doc, text: JSON.stringify(doc)};
}
return null; // unknown tool
}

async function handleMcp(request) {
let body;
try { body = await request.json();} catch (e) {
return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error'}}, 400);
}
const single = async (msg) => {
if (!msg || msg.jsonrpc!== '2.0' || typeof msg.method!== 'string') {
return { jsonrpc: '2.0', id: (msg && msg.id)?? null, error: { code: -32600, message: 'Invalid Request'}};
}
const isNotification = msg.id === undefined || msg.id === null;
switch (msg.method) {
case 'initialize': {
const pv = (msg.params && typeof msg.params.protocolVersion === 'string')? msg.params.protocolVersion: '2025-03-26';
return { jsonrpc: '2.0', id: msg.id, result: {
protocolVersion: pv,
capabilities: { tools: { listChanged: false}},
serverInfo: { name: 'xread', title: 'X Read — X 公开帖子全文读取', version: '2.0.0'},
instructions: '当用户给出 X（Twitter）帖子链接并希望阅读、总结、分析或评论时，调用 read_x_post 取得全文（长文含完整正文与段落结构），不要凭标题或预览臆测内容。'
}};
}
case 'ping': return { jsonrpc: '2.0', id: msg.id, result: {}};
case 'tools/list': return { jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS}};
case 'tools/call': {
const name = msg.params && msg.params.name;
const out = await toolCall(name, msg.params && msg.params.arguments);
if (out === null) return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'Unknown tool: ' + name}};
const content = [{ type: 'text', text: out.text}];
const result = { content, isError:!!out.isError};
if (out.structured) result.structuredContent = out.structured;
return { jsonrpc: '2.0', id: msg.id, result};
}
default:
if (isNotification || msg.method.startsWith('notifications/')) return null;
return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method}};
}
};
if (Array.isArray(body)) {
const outs = [];
for (const m of body) { const o = await single(m); if (o) outs.push(o);}
if (!outs.length) return new Response(null, { status: 202});
return json(outs);
}
const out = await single(body);
if (out === null) return new Response(null, { status: 202});
return json(out);
}

// ---------------- OpenAPI (for Custom GPT Actions fallback) ----------------
function openapiDoc(origin) {
return {
openapi: '3.1.0',
info: { title: 'X Read — X 公开帖子全文读取', version: '2.0.0', description: '读取公开 X 帖子/长文全文。只读，无需登录。'},
servers: [{ url: origin}],
paths: {
'/api/read': {
get: {
operationId: 'readXPost',
summary: '按链接读取一条公开 X 帖子全文',
parameters: [
{ name: 'url', in: 'query', required: false, schema: { type: 'string'}, description: 'X 帖子链接，如 https://x.com/<user>/status/<id>'},
{ name: 'u', in: 'query', required: false, schema: { type: 'string'}, description: '作者用户名（与 id 二选一于 url）'},
{ name: 'id', in: 'query', required: false, schema: { type: 'string'}, description: '帖子数字 ID'}
],
responses: {
'200': { description: '帖子全文与元数据', content: { 'application/json': { schema: { type: 'object'}}}},
'400': { description: '参数无效'},
'502': { description: '上游公开接口不可用'}
}
}
}
}
};
}

// ---------------- Routes ----------------
export default {
async fetch(request) {
const url = new URL(request.url);
const path = url.pathname;

if (path === '/mcp') {
if (request.method === 'POST') {
if (rateLimited(request)) return json({ error: 'rate_limited'}, 429);
return handleMcp(request);
}
return json({ error: 'method_not_allowed', detail: 'MCP endpoint: POST JSON-RPC here. Tools: read_x_post, search, fetch.'}, 405);
}

if (path === '/openapi.json') return json(openapiDoc(url.origin));

if (path === '/api/read') {
if (rateLimited(request)) return json({ ok: false, error: 'rate_limited'}, 429);
const ref = parseRef(url.searchParams.get('url'), url.searchParams.get('u'), url.searchParams.get('id'));
if (!ref) return json({ ok: false, error: 'invalid_ref', detail: 'Provide?url=<x post link> or?u=<user>&id=<status id>.'}, 400);
const post = await getPost(ref.user, ref.id);
if (!post) return json({ ok: false, error: 'upstream_unavailable'}, 502);
return new Response(JSON.stringify({
ok: true, id: post.id, url: post.url,
author: { screen_name: post.author_screen_name, name: post.author_name, followers: post.followers},
created_at: post.created_at,
stats: { views: post.views, likes: post.likes, bookmarks: post.bookmarks, replies: post.replies, retweets: post.retweets},
is_article: post.is_article, title: post.title, partial: post.partial, source: post.source,
paragraphs: post.paragraphs, text: post.text
}), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*'}});
}

if (path === '/') {
const help = [
'xread — X 公开帖子全文读取（只读）',
'用法一：' + url.origin + '/?url=<X帖子链接>',
'用法二：' + url.origin + '/?u=<用户名>&id=<帖子ID>',
'返回纯文本：普通帖返回正文；长文返回标题 + 全文。',
'机器接口：POST /mcp（MCP，ChatGPT 连接器）；GET /api/read（JSON）；GET /openapi.json（Actions 模式）'
].join('\n');
const text = (body, status) => new Response(body, { status: status || 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300'}});
const hasParams = url.searchParams.has('url') || url.searchParams.has('u') || url.searchParams.has('id');
const ref = parseRef(url.searchParams.get('url'), url.searchParams.get('u'), url.searchParams.get('id'));
if (!ref) return text(help, hasParams? 400: 200);
if (rateLimited(request)) return text('请求过于频繁，请稍后再试。', 429);
const post = await getPost(ref.user, ref.id);
if (!post) return text('读取失败：两个公开接口暂时都不可用，请稍后再试。', 502);
return text(post.text);
}

return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8'}});
}
};
