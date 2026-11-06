// Big Blue Hub story relay (Cloudflare Worker).
//
// UKAthletics.com doesn't let other sites read its story pages, so this small relay fetches one
// story and returns just its headline, date, photos, text and video as JSON. It never returns the
// page's menus, sponsor banners or ad code. Only ukathletics.com/news/ pages can be requested.
//
//   GET /story?url=https://ukathletics.com/news/2026/11/04/some-story/
//   GET /news?sport=115   a sport's latest UK stories with photos (UKAthletics.com's own lists
//                         can take 15-30 seconds, so the relay keeps a copy and refreshes it)

const ALLOWED_ORIGINS = [
  'https://kclasgens.github.io',
  'http://localhost:5173',
];
const CACHE_SECONDS = 3600;
const NEWS_FRESH_SECONDS = 600; // news lists older than this are refreshed in the background
const UK_API = 'https://ukathletics.com/wp-json';

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const reqUrl = new URL(request.url);
    if (reqUrl.pathname === '/news') return news(reqUrl, ctx, cors);
    if (reqUrl.pathname !== '/story') return json({ error: 'not found' }, 404, cors);

    let target;
    try { target = new URL(reqUrl.searchParams.get('url') || ''); } catch { return json({ error: 'bad url' }, 400, cors); }
    if (target.protocol !== 'https:' || target.hostname !== 'ukathletics.com' || !target.pathname.startsWith('/news/')) {
      return json({ error: 'only ukathletics.com/news/ stories are allowed' }, 400, cors);
    }

    // Answer repeat requests for the same story from Cloudflare's cache.
    const cacheKey = new Request(`https://relay.cache/story?url=${encodeURIComponent(target.href)}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) return withHeaders(hit, cors);

    const page = await fetch(target.href, { headers: { 'User-Agent': 'BigBlueHub-relay/1.0' } });
    if (!page.ok) return json({ error: `story returned ${page.status}` }, 502, cors);
    const story = await extract(await page.text(), target.href);

    const res = json(story, 200, { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return withHeaders(res, cors);
  },
};

// A sport's news list. A saved copy is answered at once; when it's over ten minutes old the relay
// also fetches a fresh one in the background for the next visitor.
async function news(reqUrl, ctx, cors) {
  const sport = reqUrl.searchParams.get('sport') || '';
  if (!/^\d{1,6}$/.test(sport)) return json({ error: 'bad sport' }, 400, cors);
  const cacheKey = new Request(`https://relay.cache/news?sport=${sport}`);
  const cache = caches.default;
  const refresh = async () => {
    const res = json({ items: await newsList(sport), savedAt: Date.now() }, 200, { 'Cache-Control': 'public, max-age=86400' });
    await cache.put(cacheKey, res.clone());
    return res;
  };
  const hit = await cache.match(cacheKey);
  if (hit) {
    const { savedAt } = await hit.clone().json().catch(() => ({}));
    if (!savedAt || Date.now() - savedAt > NEWS_FRESH_SECONDS * 1000) ctx.waitUntil(refresh().catch(() => {}));
    return withHeaders(hit, cors);
  }
  try {
    return withHeaders(await refresh(), cors);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502, cors);
  }
}

async function newsList(sport) {
  const get = async (url) => {
    const r = await fetch(url, { headers: { 'User-Agent': 'BigBlueHub-relay/1.0' } });
    if (!r.ok) throw new Error(`UKAthletics.com returned ${r.status}`);
    return r.json();
  };
  const [posts, ...pages] = await Promise.all([
    get(`${UK_API}/wp/v2/posts?sport_category=${sport}&per_page=12&_fields=id,date_gmt,link,title,format`),
    // Photos come from the all-sports list, which covers the newest stories.
    ...[1, 2, 3].map((page) => get(`${UK_API}/v1/news?per_page=24&page=${page}`).catch(() => ({}))),
  ]);
  const photos = new Map(pages.flatMap((p) => p.data || []).map((n) => [n.id, original(n.thumbnail || n.image)]));
  return posts.map((p) => ({ id: p.id, date_gmt: p.date_gmt, link: p.link, title: p.title?.rendered || '', format: p.format, photo: photos.get(p.id) || null }));
}

async function extract(html, href) {
  const text = (s) => decode((s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const first = (re) => (html.match(re) || [])[1];

  const title = text(first(/<h1[^>]*class="[^"]*article-hero__title[^"]*"[^>]*>([\s\S]*?)<\/h1>/));
  const crumbs = [...(first(/<ul[^>]*article-hero__breadcrumbs[^>]*>([\s\S]*?)<\/ul>/) || '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => text(m[1]));
  const hero = first(/<section[^>]*class="article-hero[\s\S]*?<img[^>]*src="([^"]+)"/);

  // Story text lives in one or more <section class="article_text N"> blocks.
  const body = [...html.matchAll(/<section class="article_text[^"]*">([\s\S]*?)<\/section>/g)]
    .map((m) => m[1].replace(/^\s*<div class="container">/, '').replace(/<\/div>\s*$/, ''))
    .join('\n');

  // Photo galleries.
  const gallery = [...html.matchAll(/<div class="image">\s*<a href="([^"]+)"[\s\S]*?(?:<span class="masonry_gallery_caption">([\s\S]*?)<\/span>)?\s*<\/a>/g)]
    .map((m) => ({ src: original(m[1]), caption: text(m[2]).replace(/^[.\s]+/, '') }))
    .filter((p) => p.src);

  // Videos: play the plain stream so the player's ads never load.
  let video = null;
  const embed = first(/<iframe[^>]*src="(https:\/\/video\.wmt\.media\/embed\/[^"]+)"/);
  if (embed) {
    try {
      const v = await (await fetch(embed)).text();
      const src = (v.match(/https:\/\/cdn\d*\.video\.wmt\.media\/stream\/[^"' ]+\.m3u8/) || [])[0];
      const poster = (v.match(/poster="(https:\/\/[^"]+)"/) || [])[1];
      if (src) video = { src, poster: poster || null };
    } catch { /* leave the video out */ }
  }

  return {
    title,
    sport: crumbs[0] || '',
    date: crumbs[1] || '',
    image: original(hero),
    html: body.replace(/https:\/\/ukathletics\.com\/imgproxy\/[^"' ]+/g, (u) => original(u) || u),
    gallery,
    video,
    url: href,
  };
}

// Photo addresses end with the original image's address in base64. The originals are far smaller
// than the oversized copies the page links to.
function original(proxied) {
  if (!proxied) return null;
  try {
    const enc = proxied.split('/').pop().replace(/\.\w+$/, '');
    const url = atob(enc.replace(/-/g, '+').replace(/_/g, '/'));
    return /^https:\/\/storage\.googleapis\.com\/ukathletics-com\//.test(url) ? url : null;
  } catch { return null; }
}

function decode(s) {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function withHeaders(res, headers) {
  const out = new Response(res.body, res);
  Object.entries(headers).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}
