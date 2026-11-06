(() => {
  'use strict';

  const CFG = window.UK_CONFIG;
  const API = 'https://site.api.espn.com/apis/site/v2/sports/';
  const SPORTS = Object.fromEntries(CFG.sports.map((s) => [s.key, s]));
  const ukId = (sportKey) => SPORTS[sportKey]?.teamId || CFG.teamId;

  // Which teams this viewer follows (Settings page). Stored per browser.
  const teamPrefs = {
    get() {
      try {
        const v = JSON.parse(localStorage.getItem('teams'));
        if (Array.isArray(v) && v.some((k) => SPORTS[k])) return v.filter((k) => SPORTS[k]);
      } catch { /* fall through to defaults */ }
      return CFG.sports.filter((s) => s.on).map((s) => s.key);
    },
    set(keys) {
      try { localStorage.setItem('teams', JSON.stringify(keys)); } catch { /* ignore */ }
      scheduleCache = null;
      socialDrawn = false;
    },
  };
  const mySports = () => { const on = teamPrefs.get(); return CFG.sports.filter((s) => on.includes(s.key)); };

  const view = document.getElementById('view');
  const social = document.getElementById('social');
  document.getElementById('app-name').textContent = CFG.appName;

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const getJSON = async (url) => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  };
  const logoOf = (team) => team?.logo || team?.logos?.[0]?.href || '';
  const scoreOf = (c) => (c?.score && typeof c.score === 'object' ? c.score.displayValue : c?.score);
  const rankOf = (c) => {
    const r = c?.curatedRank?.current ?? c?.rank;
    return r && Number(r) <= 25 ? `#${r} ` : '';
  };
  const BETTING = /\b(bet|bets|betting|odds|spread|over\/under|parlay|wager|sportsbook|picks?|prop|moneyline|fantasy|draftkings|fanduel)\b/i;
  // Photos: only ESPN-hosted https images and the app's own img/ folder are used as banner backgrounds.
  const setPhoto = (el, url) => {
    if (!el || !/^(https:\/\/[a-z0-9.-]*espncdn\.com\/|img\/)/i.test(url || '')) return;
    el.style.setProperty('--photo', `url("${url.replace(/["\\]/g, '')}")`);
    el.classList.add('has-photo');
  };
  // Latest non-betting news photo for a team: a fresh action shot for banners. Cached per session.
  const photoCache = {};
  const teamPhoto = (sportKey) => (photoCache[sportKey] ||= getJSON(`${API}${SPORTS[sportKey].path}/news?team=${ukId(sportKey)}&limit=15`)
    .then((d) => (d.articles || []).find((a) => a.images?.[0]?.url && !BETTING.test(`${a.headline} ${a.description || ''}`))?.images[0].url)
    .catch(() => null));
  const VENUE_PHOTOS = { // wide shots of packed home venues
    football: 'https://a.espncdn.com/i/venues/college-football/day/3683.jpg',
    mbb: 'https://a.espncdn.com/i/venues/mens-college-basketball/day/251.jpg',
    baseball: 'img/kentucky-proud-park.jpg',
  };
  // Credits required by the licenses of photos in img/.
  const PHOTO_CREDITS = {
    baseball: { text: 'Photo: PCN02WPS, CC BY-SA 4.0', href: 'https://commons.wikimedia.org/wiki/File:Kentucky_Proud_Park,_UK_vs._Arkansas,_May_4,_2024.jpg' },
  };
  // Banner photo for a sport: its home venue when we have one, else the latest news photo.
  const bannerPhoto = (sportKey) => (VENUE_PHOTOS[sportKey] ? Promise.resolve(VENUE_PHOTOS[sportKey]) : teamPhoto(sportKey));
  const cleanVideos = (vids) => (vids || []).filter((v) => !BETTING.test(`${v.headline} ${v.description || ''} ${v.caption || ''}`));
  const sameDay =(a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const fmtDay = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

  let timers = [];
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };

  // ---------- schedule data ----------
  // Normalizes an ESPN event (schedule or scoreboard shape) into one flat game object.
  function normalize(ev, sportKey) {
    const comp = ev.competitions[0];
    const uk = comp.competitors.find((c) => c.id === ukId(sportKey)) || comp.competitors[0];
    const opp = comp.competitors.find((c) => c !== uk);
    const status = comp.status?.type || ev.status?.type || {};
    const ukScore = scoreOf(uk);
    const oppScore = scoreOf(opp);
    const networks = (comp.broadcasts || []).map((b) => b.media?.shortName || b.names?.[0]).filter(Boolean);
    return {
      id: ev.id,
      sport: sportKey,
      date: new Date(ev.date),
      timeValid: ev.timeValid !== false && comp.timeValid !== false,
      neutral: !!comp.neutralSite,
      home: uk.homeAway === 'home',
      opp: opp?.team || {},
      oppRank: rankOf(opp),
      venue: comp.venue?.fullName || '',
      city: [comp.venue?.address?.city, comp.venue?.address?.state].filter(Boolean).join(', '),
      networks,
      state: status.state || 'pre', // pre | in | post
      detail: status.shortDetail || status.detail || '',
      completed: !!status.completed,
      ukScore, oppScore,
      result: status.completed && ukScore != null ? (uk.winner ? 'W' : 'L') : '',
    };
  }

  let scheduleCache = null;
  async function loadSchedules(force) {
    if (scheduleCache && !force) return scheduleCache;
    const results = await Promise.allSettled(
      mySports().map(async (s) => {
        const d = await getJSON(`${API}${s.path}/teams/${ukId(s.key)}/schedule`);
        return d.events.map((e) => normalize(e, s.key));
      })
    );
    const games = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    games.sort((a, b) => a.date - b.date);
    scheduleCache = { games, failed: results.filter((r) => r.status === 'rejected').length };
    return scheduleCache;
  }

  // Refreshes status/score for live (or about-to-start) games via the lightweight summary header.
  async function refreshLive(games) {
    const now = Date.now();
    const targets = games.filter((g) => g.state === 'in' || (g.state === 'pre' && Math.abs(g.date - now) < 30 * 60e3));
    await Promise.all(targets.map(async (g) => {
      try {
        const d = await getJSON(`${API}${SPORTS[g.sport].path}/summary?event=${g.id}`);
        const comp = d.header.competitions[0];
        const uk = comp.competitors.find((c) => c.id === ukId(g.sport));
        const opp = comp.competitors.find((c) => c !== uk);
        const st = comp.status.type;
        Object.assign(g, {
          state: st.state, detail: st.shortDetail || st.detail, completed: st.completed,
          ukScore: scoreOf(uk), oppScore: scoreOf(opp),
          result: st.completed ? (uk.winner ? 'W' : 'L') : '',
        });
      } catch { /* keep last known */ }
    }));
    return targets.length > 0;
  }

  // ---------- watch helpers ----------
  function watchLinks(networks) {
    const out = [];
    const ytv = networks.filter((n) => CFG.watch.youtubeTv.includes(n));
    if (ytv.length) out.push({ label: `YouTube TV · ${ytv.join(', ')}`, href: CFG.watch.links.youtubeTv, cls: 'ytv' });
    networks.forEach((n) => {
      if (CFG.watch.links[n]) out.push({ label: n === 'SECN+' ? 'SEC Network+ (ESPN app)' : n, href: CFG.watch.links[n], cls: 'secondary' });
    });
    return out;
  }
  const tvText = (g) => (g.networks.length ? g.networks.join(' / ') : 'TBA');

  // Free live radio from the UK Sports Network, for games that haven't finished.
  const radioFor = (g) => {
    const mode = SPORTS[g.sport]?.radio;
    return CFG.radio && mode && g.state !== 'post' ? { ...CFG.radio, select: mode === 'select' } : null;
  };
  const listenTitle = (r) => `${r.label} on ${r.station}${r.select ? ' (select matches are on the radio)' : ''}`;
  // Game cards are links themselves, so the radio button inside them is a span handled by the click delegate.
  const listenChip = (g) => {
    const r = radioFor(g);
    return r ? `<span class="listen" role="link" tabindex="0" data-listen="${esc(r.url)}" title="${esc(listenTitle(r))}">🎧 Listen live</span>` : '';
  };
  const listenLink = (g, cls = 'listen') => {
    const r = radioFor(g);
    return r ? `<a class="${cls}" href="${esc(r.url)}" target="_blank" rel="noopener" data-listen-link title="${esc(listenTitle(r))}">🎧 Listen live</a>` : '';
  };

  // ---------- game-day weather (outdoor sports) ----------
  // Free forecasts from Open-Meteo (no key needed); they reach about two weeks ahead.
  const DOMES = /dome|mercedes-benz stadium|at&t stadium|nrg stadium|allegiant|ford field|lucas oil|u\.s\. bank stadium|state farm stadium|tropicana|daikin park|minute maid|rogers centre|chase field|globe life field|american family field|t-mobile park|loandepot/i;
  const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
  const WX = [[0, '☀️', 'Clear'], [1, '🌤️', 'Mostly clear'], [2, '⛅', 'Partly cloudy'], [3, '☁️', 'Cloudy'], [48, '🌫️', 'Fog'], [57, '🌦️', 'Drizzle'], [65, '🌧️', 'Rain'], [67, '🌧️', 'Freezing rain'], [77, '🌨️', 'Snow'], [82, '🌦️', 'Showers'], [86, '🌨️', 'Snow showers'], [99, '⛈️', 'Thunderstorms']];
  const wxKind = (code) => WX.find(([max]) => code <= max) || WX[3];
  const wantsWeather = (g) => SPORTS[g.sport]?.weather && g.state !== 'post' && g.timeValid && g.city && !DOMES.test(g.venue)
    && g.date - Date.now() < 14 * 864e5;
  const geoCache = {};
  const geocode = (city) => (geoCache[city] ||= (async () => {
    const [name, st] = city.split(',').map((x) => x.trim());
    const state = STATES[(st || '').toUpperCase()] || st;
    const d = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&countryCode=US`);
    const hit = (d.results || []).find((r) => !state || r.admin1 === state) || d.results?.[0];
    if (!hit) throw new Error('place not found');
    return hit;
  })());
  const wxCache = {};
  const wxDone = {}; // finished forecasts, so redrawn cards show them right away
  const gameWeather = (g) => (wxCache[g.id] ||= (async () => {
    const loc = await geocode(g.city);
    const at = new Date(Math.round(g.date / 36e5) * 36e5); // nearest hour to the start time
    const day = at.toISOString().slice(0, 10);
    const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT&start_date=${day}&end_date=${day}`);
    const i = d.hourly.time.indexOf(at.toISOString().slice(0, 13) + ':00');
    if (i < 0) return null;
    const h = d.hourly;
    return (wxDone[g.id] = { temp: Math.round(h.temperature_2m[i]), rain: h.precipitation_probability[i] ?? 0, code: h.weather_code[i], wind: Math.round(h.wind_speed_10m[i]) });
  })().catch(() => null));
  const wxShort = (w) => `${wxKind(w.code)[1]} <b>${w.temp}°</b> ${esc(wxKind(w.code)[2])} · ${w.rain}% rain`;
  const wxLong = (w) => `${wxKind(w.code)[1]} <b>${w.temp}°F</b>, ${esc(wxKind(w.code)[2].toLowerCase())} · ${w.rain}% chance of rain · wind ${w.wind} mph`;
  const wxSlot = (g, long) => (wantsWeather(g)
    ? `<div class="wx" data-wx="${esc(g.id)}"${long ? ' data-long' : ''}>${wxDone[g.id] ? (long ? wxLong : wxShort)(wxDone[g.id]) : ''}</div>` : '');
  // Fills every forecast slot in `root` once its forecast arrives.
  function fillWeather(root, games) {
    root.querySelectorAll('[data-wx]').forEach((el) => {
      const g = games.find((x) => String(x.id) === el.dataset.wx);
      if (g) gameWeather(g).then((w) => { if (w) el.innerHTML = ('long' in el.dataset ? wxLong : wxShort)(w); else el.remove(); });
    });
  }
  const whereText = (g) => (g.neutral ? 'vs' : g.home ? 'vs' : '@');

  // ---------- components ----------
  function statusLine(g) {
    if (g.state === 'in') return `<span class="live-dot">LIVE</span> <span class="small">${esc(g.detail)}</span>`;
    if (g.state === 'post') {
      if (!g.result) return `<span class="small muted">${esc(g.detail)}</span>`;
      return `<span class="result-${g.result}">${g.result}</span> <span class="score">${esc(g.ukScore)}-${esc(g.oppScore)}</span>`;
    }
    return `<span class="small"><b>${g.timeValid ? esc(fmtTime(g.date)) : 'TBA'}</b></span>`;
  }

  function gameCard(g) {
    const s = SPORTS[g.sport];
    return `
      <a class="gcard" href="#/game/${g.sport}/${g.id}">
        <div class="row1"><span class="tag ${s.short}">${s.short}</span>${statusLine(g)}</div>
        <div class="opp">
          <img src="${esc(logoOf(g.opp))}" alt="" loading="lazy">
          <div><span class="va">${whereText(g)}</span> ${esc(g.oppRank)}${esc(g.opp.shortDisplayName || g.opp.displayName)}</div>
        </div>
        <div class="meta">
          <div>📍 ${esc(g.venue)}${g.city ? `, ${esc(g.city)}` : ''}</div>
          <div>📺 <b>${esc(tvText(g))}</b></div>
          ${wxSlot(g)}
        </div>
        ${listenChip(g)}
      </a>`;
  }

  function weekGrid(games) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 864e5));
    return `<div class="week">${days.map((d, i) => {
      const dayGames = games.filter((g) => sameDay(g.date, d));
      return `
        <div class="day ${i === 0 ? 'today' : ''} ${dayGames.length ? 'has-games' : ''}">
          <div class="day-head"><span>${i === 0 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
            <span class="dnum">${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
          ${dayGames.length ? dayGames.map(gameCard).join('') : '<div class="nogame">No games</div>'}
        </div>`;
    }).join('')}</div>`;
  }

  // Big photo banner for the next (or live) game on the home page.
  function homeBanner(g) {
    const s = SPORTS[g.sport];
    const when = g.state === 'in' ? `<span class="live-dot" style="color:#fff">LIVE</span> ${esc(g.detail)}`
      : `${esc(g.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))} · ${g.timeValid ? esc(fmtTime(g.date)) : 'Time TBA'}`;
    return `
      <section class="home-banner">
        <div>
          <div class="eyebrow">${g.state === 'in' ? 'Happening now' : 'Next up'} · Kentucky ${esc(s.label)}</div>
          <h1>${whereText(g) === '@' ? 'at' : 'vs'} ${esc(g.oppRank)}${esc(g.opp.displayName || g.opp.shortDisplayName)}</h1>
          <div class="when">${when}</div>
          <div class="when small">📍 ${esc(g.venue)}${g.city ? `, ${esc(g.city)}` : ''} · 📺 ${esc(tvText(g))}</div>
          ${wxSlot(g, true)}
          <div class="banner-btns"><a class="btn" href="#/game/${g.sport}/${g.id}">${g.state === 'in' ? 'Follow live' : 'Game preview'} →</a>${listenLink(g, 'btn ghost')}</div>
        </div>
        <img class="opp-logo" src="${esc(logoOf(g.opp))}" alt="">
      </section>`;
  }

  function scheduleTable(games) {
    if (!games.length) return '<div class="empty">No games found.</div>';
    return `<table class="sched"><tbody>${games.map((g) => {
      const s = SPORTS[g.sport];
      return `
        <tr data-href="#/game/${g.sport}/${g.id}">
          <td class="when"><span class="tag ${s.short}">${s.short}</span><br><span class="small">${esc(fmtDay(g.date))}</span></td>
          <td><div class="oppcell"><img src="${esc(logoOf(g.opp))}" alt="" loading="lazy">
            <span><span class="muted small">${whereText(g)}</span> ${esc(g.oppRank)}${esc(g.opp.shortDisplayName || g.opp.displayName)}</span></div></td>
          <td class="venue-col small muted">${esc(g.venue)}</td>
          <td style="text-align:right">${statusLine(g)}<div class="tv">${g.state === 'pre' ? esc(tvText(g)) : ''}</div>${listenLink(g)}</td>
        </tr>`;
    }).join('')}</tbody></table>`;
  }

  function bindRowLinks(root) {
    root.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (!e.target.closest('a')) location.hash = tr.dataset.href;
    }));
  }

  // ---------- pages ----------
  async function homePage() {
    view.innerHTML = '<div class="loading">Loading schedule…</div>';
    renderSocial();
    let data;
    try { data = await loadSchedules(true); } catch (e) { view.innerHTML = `<div class="error">Couldn't load schedule: ${esc(e.message)}</div>`; return; }

    const draw = () => {
      const now = new Date();
      const live = data.games.filter((g) => g.state === 'in');
      const recent = data.games.filter((g) => g.state === 'post' && now - g.date < 14 * 864e5).slice(-6).reverse();
      const next = data.games.find((g) => g.state === 'pre');
      const featured = live[0] || next;
      view.innerHTML = `
        ${featured ? homeBanner(featured) : ''}
        ${live.length ? `<section class="card"><h2><span class="live-dot">LIVE NOW</span></h2><div class="week" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${live.map(gameCard).join('')}</div></section>` : ''}
        <section class="card">
          <h2>This week <span class="small muted" style="text-transform:none;letter-spacing:0">${esc(fmtDay(now))} – ${esc(fmtDay(new Date(now.getTime() + 6 * 864e5)))}</span></h2>
          ${weekGrid(data.games)}
          ${next && next.date - now > 7 * 864e5 ? `<p class="small muted">Next game: ${esc(fmtDay(next.date))} vs ${esc(next.opp.displayName)}</p>` : ''}
        </section>
        <section class="card">
          <h2>Recent results</h2>
          ${recent.length ? scheduleTable(recent) : '<div class="empty">No games in the last two weeks.</div>'}
        </section>
        ${data.failed ? `<div class="error small">${data.failed} sport schedule(s) failed to load.</div>` : ''}
      `;
      bindRowLinks(view);
      fillWeather(view, data.games);
      if (featured) bannerPhoto(featured.sport).then((url) => setPhoto(view.querySelector('.home-banner'), url));
    };
    draw();

    // Keep live games fresh while this page is open.
    const tick = async () => { if (await refreshLive(data.games)) draw(); };
    tick();
    timers.push(setInterval(tick, 30e3));
  }

  function settingsPage() {
    renderSocial();
    const draw = (savedMsg) => {
      const on = teamPrefs.get();
      view.innerHTML = `
        <section class="card settings">
          <h2>Settings</h2>
          <h3>My teams</h3>
          <p class="small muted">Choose the Kentucky teams you want on your home page and social links.</p>
          <div class="team-picks">${CFG.sports.map((s) => `
            <label class="team-pick">
              <input type="checkbox" value="${esc(s.key)}" ${on.includes(s.key) ? 'checked' : ''}>
              <span class="tag ${s.short}">${esc(s.short)}</span>
              <span class="pick-name">${esc(s.label)}</span>
            </label>`).join('')}</div>
          <p class="small save-msg" role="status">${savedMsg || ''}</p>
        </section>`;
      view.querySelectorAll('.team-pick input').forEach((box) => box.addEventListener('change', () => {
        const keys = [...view.querySelectorAll('.team-pick input:checked')].map((b) => b.value);
        if (!keys.length) { box.checked = true; draw('<span class="error-text">Keep at least one team selected.</span>'); return; }
        teamPrefs.set(keys);
        renderSocial();
        draw('✓ Saved');
      }));
    };
    draw();
  }

  // ---------- team pages ----------
  const teamState = { poll: null };

  function titlesCard(sportKey) {
    const titles = CFG.titles?.[sportKey];
    if (!titles?.length) return '';
    return `<section class="card"><h2>Championships</h2>
      <ul class="titles">${titles.map((t) => `
        <li><span class="count${t.count ? '' : ' zero'}">${Number(t.count) || 0}</span><span><b>${esc(t.label)}</b>${t.note ? `<span class="small muted">${esc(t.note)}</span>` : ''}</span></li>`).join('')}
      </ul>
      ${CFG.titlesAsOf ? `<p class="small muted titles-asof">${esc(CFG.titlesAsOf)}</p>` : ''}
    </section>`;
  }

  function teamPage(sportKey) {
    const mine = mySports();
    const sport = SPORTS[sportKey] || mine[0];
    if (sportKey !== sport.key) { location.replace(`#/team/${sport.key}`); return; }
    const id = ukId(sport.key);
    const base = `${API}${sport.path}`;

    view.innerHTML = `
      <div class="chips team-switch">${(mine.some((s) => s.key === sport.key) ? mine : [...mine, sport]).map((s) => `
        <a class="chip ${s.key === sport.key ? 'active' : ''}" href="#/team/${s.key}">${esc(s.label)}</a>`).join('')}</div>
      <section class="team-hero" id="t-hero">
        <img src="https://a.espncdn.com/i/teamlogos/ncaa/500-dark/96.png" alt="" width="84" height="84">
        <div><h1>Kentucky ${esc(sport.label)}</h1><div class="hero-meta">Loading…</div></div>
        ${PHOTO_CREDITS[sport.key] ? `<a class="photo-credit" href="${esc(PHOTO_CREDITS[sport.key].href)}" target="_blank" rel="noopener">${esc(PHOTO_CREDITS[sport.key].text)}</a>` : ''}
      </section>
      <div class="team-grid">
        <div>
          <section class="card" id="t-next"><h2>Up next</h2><div class="loading">Loading…</div></section>
          <section class="card" id="t-standings"><h2>SEC standings</h2><div class="loading">Loading…</div></section>
          <section class="card" id="t-schedule"><h2>Schedule &amp; results</h2><div class="loading">Loading…</div></section>
        </div>
        <div>
          <section class="card" id="t-polls"><h2>Rankings</h2><div class="loading">Loading…</div></section>
          ${titlesCard(sport.key)}
          <section class="card" id="t-news"><h2>News</h2><div class="loading">Loading…</div></section>
          <section class="card" id="t-roster"><h2>Roster</h2><div class="loading">Loading…</div></section>
          <section class="card"><h2>Follow</h2><div class="social-grid one-col">
            <a class="social-link" href="https://x.com/${esc(sport.x)}" target="_blank" rel="noopener"><span class="ico x">𝕏</span><span>@${esc(sport.x)}<span class="who">on X</span></span></a>
            <a class="social-link" href="https://www.instagram.com/${esc(sport.ig)}/" target="_blank" rel="noopener"><span class="ico ig">◎</span><span>@${esc(sport.ig)}<span class="who">on Instagram</span></span></a>
          </div></section>
        </div>
      </div>`;

    bannerPhoto(sport.key).then((url) => current() && setPhoto(view.querySelector('#t-hero'), url));
    const fill = (sel, html) => { const el = view.querySelector(sel); if (el) el.innerHTML = el.querySelector('h2').outerHTML + html; };
    const fail = (sel, what) => fill(sel, `<div class="empty">${what} isn't available right now.</div>`);
    const current = () => location.hash === `#/team/${sport.key}`; // ignore late responses after navigating away
    const heroBits = {};
    const drawHero = () => {
      if (!current()) return;
      const bits = [
        heroBits.record && `<span class="hero-stat"><b>${esc(heroBits.record)}</b> overall</span>`,
        heroBits.conf && `<span class="hero-stat"><b>${esc(heroBits.conf)}</b> SEC</span>`,
        heroBits.place && `<span class="hero-stat"><b>${esc(heroBits.place)}</b> in SEC</span>`,
        ...(heroBits.ranks || []).map((r) => `<span class="hero-stat rank"><b>#${esc(r.rank)}</b> ${esc(r.poll)}</span>`),
        heroBits.coach && `<span class="hero-stat">Coach <b>${esc(heroBits.coach)}</b></span>`,
      ].filter(Boolean);
      view.querySelector('#t-hero .hero-meta').innerHTML = bits.join('') || '';
    };

    // Schedule (also gives the overall record when standings lack it).
    getJSON(`${base}/teams/${id}/schedule`).then((d) => {
      if (!current()) return;
      const games = d.events.map((e) => normalize(e, sport.key)).sort((a, b) => a.date - b.date);
      const next = games.find((g) => g.state !== 'post');
      fill('#t-next', next ? `<div class="next-wrap">${gameCard(next)}</div>` : '<div class="empty">No upcoming games scheduled yet.</div>');
      fill('#t-schedule', scheduleTable(games));
      bindRowLinks(view.querySelector('#t-schedule'));
      fillWeather(view, games);
      if (!heroBits.record) {
        const w = games.filter((g) => g.result === 'W').length, l = games.filter((g) => g.result === 'L').length;
        if (w + l) { heroBits.record = `${w}-${l}`; drawHero(); }
      }
    }).catch(() => { fail('#t-next', 'Schedule'); fail('#t-schedule', 'Schedule'); });

    // SEC standings.
    getJSON(`https://site.api.espn.com/apis/v2/sports/${sport.path}/standings?group=${sport.sec}`).then((d) => {
      if (!current()) return;
      const stat = (e, type) => e.stats.find((s) => s.type === type);
      const rows = (d.standings?.entries || []).map((e) => ({
        team: e.team,
        seed: Number(stat(e, 'playoffseed')?.value) || 0,
        confPct: Number(stat(e, 'leaguewinpercent')?.value) || 0,
        pct: Number(stat(e, 'winpercent')?.value ?? 0),
        conf: stat(e, 'vsconf')?.displayValue,
        overall: stat(e, 'total')?.displayValue,
        streak: stat(e, 'streak')?.displayValue,
      }));
      if (!rows.length) return fail('#t-standings', 'Standings');
      const bySeed = rows.every((r) => r.seed > 0);
      rows.sort((a, b) => (bySeed ? a.seed - b.seed : (b.confPct - a.confPct) || (b.pct - a.pct)));
      const hasConfRecord = rows.some((r) => r.conf);
      const hasStreak = rows.some((r) => r.streak && r.streak !== '-');
      fill('#t-standings', `
        <table class="standings">
          <thead><tr><th></th><th>Team</th><th>${hasConfRecord ? 'SEC' : 'SEC %'}</th><th>Overall</th>${hasStreak ? '<th>Strk</th>' : ''}</tr></thead>
          <tbody>${rows.map((r, i) => `
            <tr class="${r.team.id === id ? 'me' : ''}">
              <td class="muted">${i + 1}</td>
              <td><span class="st-team"><img src="${esc(logoOf(r.team))}" alt="" loading="lazy">${esc(r.team.shortDisplayName || r.team.location)}</span></td>
              <td>${esc(hasConfRecord ? r.conf || '' : r.confPct.toFixed(3).replace(/^0/, ''))}</td>
              <td>${esc(r.overall || '')}</td>
              ${hasStreak ? `<td>${esc(r.streak && r.streak !== '-' ? r.streak : '')}</td>` : ''}
            </tr>`).join('')}</tbody>
        </table>
        <p class="small muted" style="margin-bottom:0">${esc(d.season?.displayName || '')} season</p>`);
      const me = rows.findIndex((r) => r.team.id === id);
      if (me >= 0) {
        heroBits.record = rows[me].overall || heroBits.record;
        heroBits.conf = rows[me].conf;
        const n = me + 1;
        const sfx = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
        heroBits.place = `${n}${sfx}`;
        drawHero();
      }
    }).catch(() => fail('#t-standings', 'Standings'));

    // Rankings: CFP / AP / Coaches / AVCA — Division I polls only.
    getJSON(`${base}/rankings`).then((d) => {
      if (!current()) return;
      const order = { cfp: 0, ap: 1, usa: 2 };
      const polls = (d.rankings || [])
        .filter((r) => r.ranks?.length && !/FCS|Division II|Division III|Div II/i.test(`${r.name} ${r.headline}`))
        .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
      if (!polls.length) return fill('#t-polls', '<div class="empty">ESPN doesn\'t publish polls for this sport.</div>');
      const pollName = (p) => (p.type === 'cfp' ? 'CFP' : p.type === 'usa' ? 'Coaches' : /AVCA/.test(p.name) ? 'AVCA' : 'AP Top 25');
      heroBits.ranks = polls.map((p) => {
        const r = p.ranks.find((x) => x.team?.id === id);
        return r && { rank: r.current, poll: pollName(p).replace(' Top 25', '') };
      }).filter(Boolean);
      drawHero();
      const drawPolls = () => {
        const p = polls.find((x) => pollName(x) === teamState.poll) || polls[0];
        teamState.poll = pollName(p);
        fill('#t-polls', `
          ${polls.length > 1 ? `<div class="chips" style="margin-bottom:10px">${polls.map((x) => `<button class="chip ${x === p ? 'active' : ''}" data-poll="${esc(pollName(x))}">${esc(pollName(x))}</button>`).join('')}</div>` : ''}
          <p class="small muted" style="margin-top:0">${esc(p.headline || p.name)}</p>
          <ol class="poll">${p.ranks.map((r) => {
            // First poll of a season (preseason, first CFP release) has nothing to compare against.
            if (!p.ranks.some((x) => x.previous)) r = { ...r, previous: r.current };
            const move = r.previous && r.previous !== r.current ? r.previous - r.current : 0;
            return `<li class="${r.team?.id === id ? 'me' : ''}">
              <span class="rk">${esc(r.current)}</span>
              <img src="${esc(logoOf(r.team) || r.team?.logos?.[0]?.href)}" alt="" loading="lazy">
              <span class="pt">${esc(r.team?.location || r.team?.nickname)}<span class="muted small"> ${esc(r.recordSummary || '')}</span></span>
              <span class="mv ${move > 0 ? 'up' : move < 0 ? 'down' : ''}">${move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : !r.previous ? 'NEW' : '–'}</span>
            </li>`;
          }).join('')}</ol>
          ${p.ranks.some((r) => r.team?.id === id) ? '' : '<p class="small muted" style="margin-bottom:0">Kentucky is not ranked in this poll.</p>'}`);
        view.querySelectorAll('[data-poll]').forEach((b) => b.addEventListener('click', () => { teamState.poll = b.dataset.poll; drawPolls(); }));
      };
      drawPolls();
    }).catch(() => fill('#t-polls', '<div class="empty">ESPN doesn\'t publish polls for this sport.</div>'));

    // News: ESPN and official UKAthletics.com stories together, newest first. Betting stories and
    // ESPN+ paywalled stories are filtered out.
    const espnNews = getJSON(`${base}/news?team=${id}&limit=20`).then((d) => (d.articles || [])
      .filter((a) => !a.premium && !/\/betting\/|\/fantasy\//.test(a.links?.web?.href || ''))
      .map((a) => ({
        source: 'ESPN', headline: a.headline, text: a.description || '', date: new Date(a.published), href: a.links?.web?.href || '#',
        api: a.links?.api?.self?.href || '', thumb: a.images?.[0]?.url, video: a.type === 'Media',
      })));
    Promise.allSettled([espnNews, ukNews(sport)]).then(([espn, uk]) => {
      if (!current()) return;
      if (espn.status === 'rejected' && uk.status === 'rejected') return fail('#t-news', 'News');
      const items = [...(espn.value || []), ...(uk.value || [])]
        .filter((n) => !BETTING.test(`${n.headline} ${n.text}`))
        .sort((a, b) => b.date - a.date).slice(0, 12);
      fill('#t-news', items.length ? `<div class="news">${items.map((n) => `
        <a class="news-item" href="${esc(n.href)}" target="_blank" rel="noopener" ${n.uk ? `data-uk="${esc(n.uk)}"` : `data-api="${esc(n.api)}"`}>
          <span class="news-thumb">${n.thumb ? `<img src="${esc(n.thumb)}" alt="" loading="lazy"${n.full ? ` data-full="${esc(n.full)}"` : ''}>` : '<span class="no-thumb"></span>'}${n.video ? '<span class="play">▶</span>' : n.gallery ? '<span class="play">📷</span>' : ''}</span>
          <span><b>${esc(n.headline)}</b><span class="small muted">${esc(n.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))} · <span class="src${n.uk ? ' uk' : ''}">${esc(n.source)}</span></span></span>
        </a>`).join('')}</div>` : '<div class="empty">No recent news.</div>');
      // Some UK photos have no small copy; fall back to the full photo.
      view.querySelectorAll('#t-news img[data-full]').forEach((img) => img.addEventListener('error', () => { img.src = img.dataset.full; img.removeAttribute('data-full'); }, { once: true }));
    }).catch((e) => { console.error(e); fail('#t-news', 'News'); });

    // Roster (+ head coach for the hero).
    getJSON(`${base}/teams/${id}/roster`).then((d) => {
      if (!current()) return;
      const c = d.coach?.[0];
      if (c) { heroBits.coach = `${c.firstName} ${c.lastName}`; drawHero(); }
      const groups = (d.athletes || []).length && d.athletes[0].items
        ? d.athletes.filter((g) => g.items?.length).map((g) => ({ name: { offense: 'Offense', defense: 'Defense', specialTeam: 'Special teams' }[g.position] || g.position, items: g.items }))
        : [{ name: '', items: d.athletes || [] }];
      if (!groups.some((g) => g.items.length)) return fill('#t-roster', '<div class="empty">Roster not available.</div>');
      fill('#t-roster', `<details class="roster"><summary>Show ${groups.reduce((n, g) => n + g.items.length, 0)} players</summary>${groups.map((g) => `
        ${g.name ? `<div class="group-label">${esc(g.name)}</div>` : ''}
        <ul class="roster-list">${[...g.items].sort((a, b) => (Number(a.jersey) || 999) - (Number(b.jersey) || 999)).map((a) => `
          <li><span class="jn">${esc(a.jersey ?? '')}</span><img class="hs" src="${esc(a.headshot?.href || logoOf(d.team))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
            <span><b>${esc(a.displayName)}</b><span class="small muted"> ${esc([a.position?.abbreviation, a.experience?.displayValue, a.displayHeight, a.displayWeight].filter(Boolean).join(' · '))}</span></span></li>`).join('')}</ul>`).join('')}</details>`);
    }).catch(() => fail('#t-roster', 'Roster'));
  }

  // ---------- game page ----------
  const gameState = { tab: 'overview', openDrives: new Set() };

  async function gamePage(sportKey, id) {
    const sport = SPORTS[sportKey];
    if (!sport) { view.innerHTML = '<div class="error">Unknown sport.</div>'; return; }
    gameState.tab = 'overview';
    gameState.openDrives = new Set();
    view.innerHTML = '<div class="loading">Loading game…</div>';

    let d;
    const load = async () => {
      d = await getJSON(`${API}${sport.path}/summary?event=${id}`);
      drawGame(d, sportKey);
    };
    try { await load(); } catch (e) { view.innerHTML = `<div class="error">Couldn't load game: ${esc(e.message)}</div>`; return; }

    // Poll fast while live, slowly before tip/kick, not at all once final.
    const poll = async () => {
      const state = d?.header?.competitions?.[0]?.status?.type?.state;
      if (state === 'post') return;
      const due = state === 'in' ? 15e3 : 60e3;
      if (Date.now() - (poll.last || 0) < due - 500) return;
      poll.last = Date.now();
      try { await load(); } catch { /* keep last render */ }
    };
    poll.last = Date.now();
    timers.push(setInterval(poll, 15e3));
  }

  function drawGame(d, sportKey) {
    const isFootball = sportKey === 'football';
    const comp = d.header.competitions[0];
    const st = comp.status.type;
    const away = comp.competitors.find((c) => c.homeAway === 'away');
    const home = comp.competitors.find((c) => c.homeAway === 'home');
    const teams = [away, home];
    const byId = Object.fromEntries(teams.map((c) => [c.id, c.team]));

    // Some sports (e.g. volleyball) send team shells with no numbers; only show tabs that have data.
    const hasTeamStats = d.boxscore?.teams?.some((t) => t.statistics?.length);
    const hasBox = d.boxscore?.players?.some((p) => p.statistics?.some((g) => g.athletes?.length));
    const scoring = isFootball
      ? (d.scoringPlays || [])
      : (d.plays || []).filter((p) => p.scoringPlay && p.text);
    const tabs = [
      ['overview', 'Overview'],
      ...(scoring.length ? [['scoring', 'Scoring plays']] : []),
      ...(hasTeamStats ? [['team', 'Team stats']] : []),
      ...(hasBox ? [['box', 'Box score']] : []),
      ...((isFootball ? d.drives?.previous?.length || d.drives?.current : d.plays?.length) ? [['pbp', 'Play-by-play']] : []),
      ...(cleanVideos(d.videos).length ? [['video', 'Highlights']] : []),
    ];
    if (!tabs.some((t) => t[0] === gameState.tab)) gameState.tab = 'overview';

    const networks = (comp.broadcasts || d.broadcasts || []).map((b) => b.media?.shortName).filter(Boolean);
    const watch = watchLinks(networks);
    const venue = d.gameInfo?.venue || comp.venue || {};
    const game = { // just enough of a schedule game for the radio and weather helpers
      id: String(comp.id || d.header.id), sport: sportKey, state: st.state, date: new Date(comp.date), timeValid: comp.timeValid !== false,
      venue: venue.fullName || '', city: [venue.address?.city, venue.address?.state].filter(Boolean).join(', '),
    };
    const isLive = st.state === 'in';

    const teamBlock = (c) => `
      <div class="team">
        <img src="${esc(logoOf(c.team))}" alt="">
        <div class="name">${esc(rankOf(c))}${esc(c.team.shortDisplayName || c.team.location)}</div>
        <div class="rec">${esc(c.record?.[0]?.summary || '')}</div>
        ${isLive && c.possession ? '<span class="poss">BALL</span>' : ''}
      </div>`;
    const sA = scoreOf(away), sH = scoreOf(home);
    const periods = Math.max(...teams.map((c) => c.linescores?.length || 0));
    const periodLabel = (i) => {
      if (sportKey === 'baseball') return `${i + 1}`; // innings
      if (sportKey === 'wvb') return `S${i + 1}`; // sets
      if (sportKey === 'mbb') return i < 2 ? `H${i + 1}` : i === 2 ? 'OT' : `${i - 1}OT`;
      return i < 4 ? `Q${i + 1}` : i === 4 ? 'OT' : `${i - 3}OT`;
    };
    const sit = d.situation;

    view.innerHTML = `
      <a class="back" href="#/">← Back</a>
      <section class="scorebug" id="scorebug">
        <div class="status">${isLive ? `<span class="live-dot">LIVE</span> ` : ''}${esc(st.state === 'pre' ? new Date(comp.date).toLocaleString(undefined, { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : st.detail)}</div>
        <div class="teams">
          ${teamBlock(away)}
          <div class="scores">${st.state === 'pre' ? '<span class="dash">vs</span>' : `
            <span class="${st.completed && !away.winner ? 'lose' : ''}">${esc(sA)}</span><span class="dash">–</span><span class="${st.completed && !home.winner ? 'lose' : ''}">${esc(sH)}</span>`}</div>
          ${teamBlock(home)}
        </div>
        ${isLive && sit?.downDistanceText ? `<div class="situation">${esc(sit.downDistanceText)}${sit.isRedZone ? ' · 🔴 Red Zone' : ''}${sit.lastPlay?.text ? `<br><span class="small">Last: ${esc(sit.lastPlay.text)}</span>` : ''}</div>` : ''}
        ${periods ? `<table class="linescore"><thead><tr><th></th>${Array.from({ length: periods }, (_, i) => `<th>${periodLabel(i)}</th>`).join('')}<th>T</th></tr></thead>
          <tbody>${teams.map((c) => `<tr><td>${esc(c.team.abbreviation)}</td>${Array.from({ length: periods }, (_, i) => `<td>${esc(c.linescores?.[i]?.displayValue ?? '')}</td>`).join('')}<td>${esc(scoreOf(c) ?? '')}</td></tr>`).join('')}</tbody></table>` : ''}
      </section>

      <section class="card">
        <h2>How to watch</h2>
        <div class="watch-row">
          ${networks.length ? `<span>📺 <b>${esc(networks.join(' / '))}</b></span>` : '<span class="muted">Broadcast TBA</span>'}
          ${watch.map((w) => `<a class="btn ${w.cls}" href="${esc(w.href)}" target="_blank" rel="noopener">▶ ${esc(w.label)}</a>`).join('')}
          ${listenLink(game, 'btn secondary')}
        </div>
        ${wantsWeather(game) ? `<div class="wx-line">Game-day forecast: ${wxSlot(game, true)}</div>` : ''}
        <p class="small muted" style="margin-bottom:0">YouTube TV doesn't allow its stream to be embedded in other sites, so this button opens the YouTube TV live guide (or app on your phone).</p>
      </section>

      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${k === gameState.tab ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="tab-body"></div>
    `;

    setPhoto(view.querySelector('#scorebug'), d.gameInfo?.venue?.images?.[0]?.href);
    fillWeather(view, [game]);
    const body = view.querySelector('#tab-body');
    const renderTab = () => {
      const t = gameState.tab;
      if (t === 'overview') body.innerHTML = overviewTab(d, teams, ukId(sportKey));
      else if (t === 'scoring') body.innerHTML = scoringTab(scoring, byId, isFootball, periodLabel);
      else if (t === 'team') body.innerHTML = teamStatsTab(d);
      else if (t === 'box') body.innerHTML = boxTab(d, ukId(sportKey));
      else if (t === 'pbp') body.innerHTML = isFootball ? drivesTab(d) : playsTab(d, byId, periodLabel);
      else if (t === 'video') body.innerHTML = videosTab(d);
      body.querySelectorAll('details.drive').forEach((el) => el.addEventListener('toggle', () => {
        el.open ? gameState.openDrives.add(el.dataset.id) : gameState.openDrives.delete(el.dataset.id);
      }));
    };
    view.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      gameState.tab = b.dataset.tab;
      view.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
      renderTab();
    }));
    renderTab();
  }

  function overviewTab(d, teams, UK) {
    const comp = d.header.competitions[0];
    const ukIsHome = teams[1].id === UK;
    const leaders = (d.leaders || []).flatMap((t) => (t.leaders || []).map((cat) => ({ team: t.team, cat, top: cat.leaders?.[0] }))).filter((x) => x.top);
    const wp = d.winprobability || [];
    const gi = d.gameInfo || {};
    // No betting data, ever: ESPN's odds/pickcenter/againstTheSpread fields are deliberately never read.
    const info = [
      ['Venue', gi.venue?.fullName],
      ['Location', [gi.venue?.address?.city, gi.venue?.address?.state].filter(Boolean).join(', ')],
      ['Attendance', gi.attendance ? Number(gi.attendance).toLocaleString() : ''],
      ['Weather', gi.weather ? `${gi.weather.temperature ?? ''}° ${gi.weather.displayValue || ''}`.trim() : ''],
      ['Kickoff', comp.status.type.state === 'pre' ? '' : new Date(comp.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })],
    ].filter(([, v]) => v);

    return `
      ${wp.length > 2 ? `<section class="card wp"><h2>Kentucky win probability</h2>${winProbChart(wp, ukIsHome)}</section>` : ''}
      ${leaders.length ? `<section class="card"><h2>Game leaders</h2><div class="leaders">${leaders.map(({ team, cat, top }) => `
        <div class="leader">
          <img src="${esc(top.athlete?.headshot?.href || logoOf(team))}" alt="" loading="lazy" onerror="this.src='${esc(logoOf(team))}'">
          <div><div class="cat">${esc(team.abbreviation)} · ${esc(cat.displayName)}</div>
            <div class="nm">${esc(top.athlete?.displayName)}</div>
            <div class="val">${esc(top.displayValue)}</div></div>
        </div>`).join('')}</div></section>` : ''}
      ${info.length ? `<section class="card"><h2>Game info</h2><div class="info-grid">${info.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}</div></section>` : ''}
      ${!leaders.length && !wp.length ? `<section class="card"><div class="empty">Stats will appear here once the game starts. This page refreshes automatically.</div></section>` : ''}
    `;
  }

  function winProbChart(wp, ukIsHome) {
    const W = 600, H = 180, pad = 4;
    const pts = wp.map((p, i) => {
      const v = ukIsHome ? p.homeWinPercentage : 1 - p.homeWinPercentage;
      return [pad + (i / (wp.length - 1)) * (W - 2 * pad), pad + (1 - v) * (H - 2 * pad)];
    });
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const mid = H / 2;
    const area = `${line}L${pts.at(-1)[0].toFixed(1)},${mid}L${pts[0][0].toFixed(1)},${mid}Z`;
    const last = ukIsHome ? wp.at(-1).homeWinPercentage : 1 - wp.at(-1).homeWinPercentage;
    return `
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Win probability chart">
        <defs>
          <clipPath id="above"><rect x="0" y="0" width="${W}" height="${mid}"/></clipPath>
          <clipPath id="below"><rect x="0" y="${mid}" width="${W}" height="${mid}"/></clipPath>
        </defs>
        <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="currentColor" stroke-opacity=".2" stroke-dasharray="4 4"/>
        <path d="${area}" fill="#0033a0" fill-opacity=".25" clip-path="url(#above)"/>
        <path d="${area}" fill="#b3261e" fill-opacity=".18" clip-path="url(#below)"/>
        <path d="${line}" fill="none" stroke="#4a90ff" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="legend"><span>Start</span><span><b style="color:var(--text)">${Math.round(last * 100)}%</b> UK now</span><span>End</span></div>`;
  }

  function scoringTab(plays, byId, isFootball, periodLabel) {
    let lastPeriod = null;
    const items = plays.map((p) => {
      const team = p.team?.logo || p.team?.logos ? p.team : byId[p.team?.id] || {};
      const per = p.period?.number;
      const head = per !== lastPeriod ? `</ul><div class="period-head">${esc(periodLabel(per - 1))}</div><ul class="plays">` : '';
      lastPeriod = per;
      return `${head}<li>
        <img src="${esc(logoOf(team))}" alt="">
        <div><div class="ptype">${esc(isFootball ? p.type?.text : p.shortDescription || p.type?.text)}</div>
          <div class="ptext">${esc(p.text)}</div><div class="pclock">${esc(p.clock?.displayValue)}</div></div>
        <div class="pscore">${esc(p.awayScore)}–${esc(p.homeScore)}</div></li>`;
    }).join('');
    return `<section class="card"><h2>Scoring plays</h2><ul class="plays">${items}</ul></section>`.replace('<ul class="plays"></ul>', '');
  }

  function teamStatsTab(d) {
    const [a, h] = d.boxscore.teams;
    const hs = Object.fromEntries((h.statistics || []).map((s) => [s.label || s.name, s.displayValue]));
    const rows = (a.statistics || []).map((s) => `<tr><td>${esc(s.displayValue)}</td><td>${esc(s.label || s.name)}</td><td>${esc(hs[s.label || s.name] ?? '')}</td></tr>`).join('');
    return `<section class="card"><h2>Team stats</h2><table class="tstats">
      <thead><tr><th><img src="${esc(logoOf(a.team))}" alt="${esc(a.team.abbreviation)}"></th><th></th><th><img src="${esc(logoOf(h.team))}" alt="${esc(h.team.abbreviation)}"></th></tr></thead>
      <tbody>${rows}</tbody></table></section>`;
  }

  function boxTab(d, UK) {
    // Show Kentucky first.
    const players = [...(d.boxscore.players || [])].sort((a, b) => (b.team.id === UK) - (a.team.id === UK));
    if (!players.length) return '<section class="card"><div class="empty">Player stats not available yet.</div></section>';
    return players.map((p) => `
      <section class="card">
        <div class="box-title"><img src="${esc(logoOf(p.team))}" alt="">${esc(p.team.displayName)}</div>
        ${p.statistics.map((g) => {
          const athletes = (g.athletes || []).filter((a) => !a.didNotPlay && a.stats?.length);
          if (!athletes.length) return '';
          return `
            ${g.name || g.type ? `<div class="group-label">${esc(g.text || g.name || g.type)}</div>` : ''}
            <div class="box-wrap"><table class="box">
              <thead><tr><th>${g.name || g.type ? '' : 'Player'}</th>${(g.labels || []).map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
              <tbody>
                ${athletes.map((a) => `<tr><td>${esc(a.athlete.shortName || a.athlete.displayName)}${a.athlete.jersey ? `<span class="jersey">#${esc(a.athlete.jersey)}</span>` : ''}${a.starter ? ' <span class="tag">S</span>' : ''}</td>${a.stats.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`).join('')}
                ${g.totals?.some((v) => v !== '') ? `<tr class="total"><td>Team</td>${g.totals.map((v) => `<td>${esc(v)}</td>`).join('')}</tr>` : ''}
              </tbody></table></div>`;
        }).join('')}
      </section>`).join('');
  }

  function drivesTab(d) {
    const drives = [...(d.drives?.previous || [])];
    if (d.drives?.current && !drives.some((x) => x.id === d.drives.current.id)) drives.push(d.drives.current);
    drives.reverse();
    return `<section class="card"><h2>Drives</h2>${drives.map((dr, i) => {
      const open = gameState.openDrives.has(dr.id) || (i === 0 && d.header.competitions[0].status.type.state === 'in');
      return `
      <details class="drive" data-id="${esc(dr.id)}" ${open ? 'open' : ''}>
        <summary><img src="${esc(logoOf(dr.team))}" alt="">
          <div><div class="dres">${esc(dr.displayResult || dr.result || 'In progress')}</div><div class="ddesc">${esc(dr.description)}</div></div>
          <span class="small muted">${esc(dr.start?.period?.number ? `Q${dr.start.period.number}` : '')} ${esc(dr.start?.clock?.displayValue || '')}</span></summary>
        <ol>${(dr.plays || []).map((p) => `<li>${p.start?.downDistanceText ? `<span class="dn">${esc(p.start.downDistanceText)}</span>` : ''}${esc(p.text)}</li>`).join('')}</ol>
      </details>`;
    }).join('')}</section>`;
  }

  function playsTab(d, byId, periodLabel) {
    const plays = [...(d.plays || [])].reverse();
    let lastPeriod = null;
    const items = plays.map((p) => {
      const per = p.period?.number;
      const head = per !== lastPeriod ? `</ul><div class="period-head">${esc(p.period?.displayValue || periodLabel(per - 1))}</div><ul class="plays">` : '';
      lastPeriod = per;
      const team = byId[p.team?.id];
      return `${head}<li>
        ${team ? `<img src="${esc(logoOf(team))}" alt="">` : '<span></span>'}
        <div><div class="ptext" ${p.scoringPlay ? 'style="font-weight:700"' : ''}>${esc(p.text)}</div><div class="pclock">${esc(p.clock?.displayValue)}</div></div>
        <div class="pscore">${esc(p.awayScore)}–${esc(p.homeScore)}</div></li>`;
    }).join('');
    return `<section class="card"><h2>Play-by-play <span class="small muted" style="text-transform:none">newest first</span></h2><ul class="plays">${items}</ul></section>`;
  }

  function videosTab(d) {
    return `<section class="card"><h2>Highlights</h2><div class="videos">${cleanVideos(d.videos).map((v) => {
      // Play ESPN's raw MP4 in our own player: no trip to espn.com, no pre-roll ads.
      const src = v.links?.source?.HD?.href || v.links?.source?.href;
      return src ? `
      <button class="video" data-src="${esc(src)}" data-title="${esc(v.headline)}" data-poster="${esc(v.thumbnail)}">
        <span class="thumb"><img src="${esc(v.thumbnail)}" alt="" loading="lazy"><span class="play">▶</span></span><span>${esc(v.headline)}</span></button>` : '';
    }).join('')}</div></section>`;
  }

  // ---------- video pop-up ----------
  const player = document.createElement('dialog');
  player.className = 'player';
  player.innerHTML = `
    <div class="player-head"><span class="player-title"></span>
      <button class="player-close" aria-label="Close video">✕</button></div>
    <video controls playsinline></video>`;
  document.body.appendChild(player);
  const playerVideo = player.querySelector('video');
  const closePlayer = () => player.close();
  player.querySelector('.player-close').addEventListener('click', closePlayer);
  // Clicking the dimmed backdrop (outside the box) closes it too; Esc is built into <dialog>.
  player.addEventListener('click', (e) => { if (e.target === player) closePlayer(); });
  player.addEventListener('close', () => { playerVideo.pause(); playerVideo.removeAttribute('src'); playerVideo.load(); });

  function openPlayer({ src, title, poster }) {
    player.querySelector('.player-title').textContent = title;
    playerVideo.poster = poster || '';
    playerVideo.src = src;
    player.showModal();
    playerVideo.play().catch(() => { /* autoplay blocked; controls are there */ });
  }
  view.addEventListener('click', (e) => {
    const listen = e.target.closest('[data-listen]');
    if (listen) { e.preventDefault(); window.open(listen.dataset.listen, '_blank', 'noopener'); return; }
    const btn = e.target.closest('.video[data-src]');
    if (btn) openPlayer(btn.dataset);
    const story = e.target.closest('.news-item[data-api]');
    if (story?.dataset.api) { e.preventDefault(); openReader(story.dataset.api, story.href); }
    const ukStory = e.target.closest('.news-item[data-uk]');
    if (ukStory && ukStories.has(ukStory.dataset.uk)) { e.preventDefault(); openUkStory(ukStories.get(ukStory.dataset.uk)); }
  });
  view.addEventListener('keydown', (e) => {
    const listen = e.key === 'Enter' && e.target.closest('[data-listen]');
    if (listen) { e.preventDefault(); window.open(listen.dataset.listen, '_blank', 'noopener'); }
  });

  // ---------- official UKAthletics.com news ----------
  // The site's news lists allow other sites to read them (its story pages don't), so stories show
  // their photo and headline here, with the full text one tap away on UKAthletics.com.
  const decodeHtml = (s) => new DOMParser().parseFromString(s || '', 'text/html').documentElement.textContent;
  // Photo addresses end with the original image's address in base64; WordPress keeps a 150px copy beside it.
  const ukPhoto = (proxied) => {
    try {
      const enc = (proxied || '').split('/').pop().replace(/\.\w+$/, '');
      const url = atob(enc.replace(/-/g, '+').replace(/_/g, '/'));
      if (!/^https:\/\/storage\.googleapis\.com\/ukathletics-com\//.test(url)) return null;
      return { full: url, thumb: url.replace(/(\.\w+)$/, '-150x150$1') };
    } catch { return null; }
  };
  let ukPhotoMap;
  // The photo list covers the newest stories across all sports, which is what the News card shows.
  const ukPhotos = () => (ukPhotoMap ||= Promise.all([1, 2, 3].map((page) =>
    getJSON(`${CFG.ukAthletics}/wp-json/v1/news?per_page=24&page=${page}`).catch(() => ({}))))
    .then((pages) => new Map(pages.flatMap((p) => p.data || []).map((n) => [n.id, ukPhoto(n.thumbnail || n.image)]))));
  const ukStories = new Map();
  async function ukNews(sport) {
    if (!CFG.ukAthletics || !sport.ukSport) return [];
    const [posts, photos] = await Promise.all([
      getJSON(`${CFG.ukAthletics}/wp-json/wp/v2/posts?sport_category=${sport.ukSport}&per_page=12&_fields=id,date_gmt,link,title,format`),
      ukPhotos().catch(() => new Map()),
    ]);
    return posts.filter((p) => /^https:\/\/ukathletics\.com\//.test(p.link)).map((p) => {
      const photo = photos.get(p.id);
      const story = {
        uk: String(p.id), source: 'UK Athletics', headline: decodeHtml(p.title?.rendered), text: '',
        date: new Date(`${p.date_gmt}Z`), href: p.link, thumb: photo?.thumb, full: photo?.full,
        video: p.format === 'video', gallery: p.format === 'gallery',
      };
      ukStories.set(story.uk, story);
      return story;
    });
  }
  function openUkStory(n) {
    reader.querySelector('.player-title').textContent = 'UK Athletics';
    const kind = n.video ? 'Watch the video' : n.gallery ? 'See the photo gallery' : 'Read the full story';
    readerBody.innerHTML = `
      <h1>${esc(n.headline)}</h1>
      <p class="reader-meta">${esc(n.date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }))}</p>
      ${n.full ? `<figure><img src="${esc(n.full)}" alt=""></figure>` : ''}
      <p><a class="btn" href="${esc(n.href)}" target="_blank" rel="noopener">${kind} on UKAthletics.com →</a></p>
      <p class="reader-source">Source: <a href="${esc(n.href)}" target="_blank" rel="noopener">UKAthletics.com</a> (official UK Athletics)</p>`;
    reader.showModal();
    readerBody.scrollTop = 0;
  }

  // ---------- news pop-up ----------
  // espn.com refuses to load inside other sites, so stories are rendered from ESPN's story feed
  // in a clean reader: text and photos only, no ads or scripts.
  const reader = document.createElement('dialog');
  reader.className = 'player reader';
  reader.innerHTML = `
    <div class="player-head"><span class="player-title">News</span>
      <button class="player-close" aria-label="Close story">✕</button></div>
    <article class="reader-body"></article>`;
  document.body.appendChild(reader);
  const readerBody = reader.querySelector('.reader-body');
  reader.querySelector('.player-close').addEventListener('click', () => reader.close());
  reader.addEventListener('click', (e) => { if (e.target === reader) reader.close(); });
  reader.addEventListener('close', () => readerBody.querySelectorAll('video').forEach((v) => v.pause()));

  const SAFE_TAGS = new Set(['P', 'H2', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'A', 'BR', 'HR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'IMG', 'FIGURE', 'FIGCAPTION', 'VIDEO']);
  const SAFE_ATTRS = ['href', 'src', 'alt', 'poster', 'controls', 'preload', 'playsinline'];
  const videoSrc = (v) => v?.links?.source?.HD?.href || v?.links?.source?.href;
  const videoFigure = (v) => (videoSrc(v) && !BETTING.test(`${v.headline} ${v.caption || ''}`)
    ? `<figure class="story-video"><video controls preload="none" playsinline src="${esc(videoSrc(v))}" poster="${esc(v.thumbnail || '')}"></video>${v.headline ? `<figcaption>${esc(v.headline)}</figcaption>` : ''}</figure>`
    : '');
  function cleanStory(html, images, videos) {
    // Video spots are marked <video1>, <video2>…; swap in ESPN's MP4 so it plays right here.
    html = html.replace(/<video(\d+)\s*\/?>/gi, (_, n) => videoFigure(videos[Number(n) - 1]));
    // ESPN marks photo spots as <photo1>, <photo2>…; swap them for the matching images.
    html = html.replace(/<photo(\d+)\s*\/?>/gi, (_, n) => {
      const img = images[Number(n) - 1];
      return img?.url ? `<figure><img src="${esc(img.url)}" alt="">${img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : ''}</figure>` : '';
    });
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const walk = (node) => {
      [...node.children].forEach((el) => {
        if (!SAFE_TAGS.has(el.tagName)) {
          // Unknown wrappers (<alsosee>, <inline1>, scripts, iframes…) are dropped with their contents.
          el.remove();
          return;
        }
        [...el.attributes].forEach((at) => { if (!SAFE_ATTRS.includes(at.name)) el.removeAttribute(at.name); });
        if (el.tagName === 'A') {
          if (!/^https?:/i.test(el.getAttribute('href') || '')) el.removeAttribute('href');
          el.target = '_blank'; el.rel = 'noopener';
        }
        if ((el.tagName === 'IMG' || el.tagName === 'VIDEO') && !/^https:/i.test(el.getAttribute('src') || '')) { el.remove(); return; }
        walk(el);
      });
    };
    walk(doc.body.firstChild);
    return doc.body.firstChild.innerHTML;
  }

  async function openReader(api, webHref) {
    readerBody.innerHTML = '<div class="loading">Loading story…</div>';
    reader.showModal();
    readerBody.scrollTop = 0;
    try {
      const data = await getJSON(api);
      // Some "news" items are just video clips: hand those to the video player.
      const clip = !data.headlines && data.videos?.[0];
      if (clip && videoSrc(clip)) {
        reader.close();
        openPlayer({ src: videoSrc(clip), title: clip.headline, poster: clip.thumbnail });
        return;
      }
      const h = data.headlines?.[0];
      if (!h?.story) throw new Error('no story');
      const images = h.images || [];
      const videos = h.video || [];
      // Videos the story doesn't place itself go at the top, in place of the lead photo.
      const leadVideo = !/<video\d/i.test(h.story) ? videoFigure(videos[0]) : '';
      const lead = leadVideo || /<photo1\b/i.test(h.story) ? null : images[0];
      reader.querySelector('.player-title').textContent = h.section || 'News';
      readerBody.innerHTML = `
        <h1>${esc(h.headline)}</h1>
        <p class="reader-meta">${esc([h.byline, h.published && new Date(h.published).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })].filter(Boolean).join(' · '))}</p>
        ${leadVideo}
        ${lead?.url ? `<figure><img src="${esc(lead.url)}" alt="">${lead.caption ? `<figcaption>${esc(lead.caption)}</figcaption>` : ''}</figure>` : ''}
        ${cleanStory(h.story, images, videos)}
        <p class="reader-source">Source: <a href="${esc(webHref)}" target="_blank" rel="noopener">ESPN.com</a></p>`;
    } catch {
      readerBody.innerHTML = `<p class="empty">This story can't be shown here. <a href="${esc(webHref)}" target="_blank" rel="noopener">Open it on ESPN.com →</a></p>`;
    }
  }

  // ---------- social links (bottom of page) ----------
  // X no longer shows embedded timelines to signed-out viewers, so this is a links section.
  let socialDrawn = false;
  function renderSocial() {
    if (socialDrawn) return;
    socialDrawn = true;
    const ig = CFG.instagram;
    const link = (href, cls, icon, handle, where) => `
      <a class="social-link" href="${esc(href)}" target="_blank" rel="noopener">
        <span class="ico ${cls}">${icon}</span><span>@${esc(handle)}<span class="who">${where}</span></span></a>`;
    social.innerHTML = `
      <section class="card">
        <h2>Follow the Cats</h2>
        <div class="social-grid">
          ${[...CFG.xHandles, ...mySports().map((s) => s.x)].filter(Boolean).map((h) => link(`https://x.com/${h}`, 'x', '𝕏', h, 'on X')).join('')}
          ${[...ig.profiles, ...mySports().map((s) => s.ig)].filter(Boolean).map((p) => link(`https://www.instagram.com/${p}/`, 'ig', '◎', p, 'on Instagram')).join('')}
        </div>
        ${ig.widgetUrl ? `<iframe src="${esc(ig.widgetUrl)}" style="width:100%;height:420px;border:0;margin-top:12px;border-radius:10px" loading="lazy" title="Instagram feed"></iframe>` : ''}
        ${ig.posts.length ? `<div class="ig-posts">${ig.posts.map((u) => `<blockquote class="instagram-media" data-instgrm-permalink="${esc(u)}" data-instgrm-version="14"></blockquote>`).join('')}</div>` : ''}
      </section>
      ${CFG.youtube.playlistId ? `<section class="card"><h2>YouTube</h2><div class="yt-embed"><iframe src="https://www.youtube.com/embed/videoseries?list=${esc(CFG.youtube.playlistId)}" title="YouTube playlist" allowfullscreen loading="lazy"></iframe></div></section>` : ''}
    `;
    if (ig.posts.length) loadScript('https://www.instagram.com/embed.js', () => window.instgrm?.Embeds.process());
  }

  const loaded = {};
  function loadScript(src, onReady) {
    if (loaded[src] === true) return onReady();
    if (loaded[src]) return loaded[src].push(onReady);
    loaded[src] = [onReady];
    const s = document.createElement('script');
    s.src = src; s.async = true; s.charset = 'utf-8';
    s.onload = () => { const cbs = loaded[src]; loaded[src] = true; cbs.forEach((cb) => cb()); };
    document.body.appendChild(s);
  }

  // ---------- router ----------
  function route() {
    clearTimers();
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    document.querySelectorAll('.topnav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#/${['settings', 'team'].includes(parts[0]) ? parts[0] : ''}` && parts[0] !== 'game'));
    window.scrollTo(0, 0);
    social.hidden = parts[0] !== ''; // "Follow the Cats" appears on the home page only
    if (parts[0] === 'game') gamePage(parts[1], parts[2]);
    else if (parts[0] === 'settings') settingsPage();
    else if (parts[0] === 'team') teamPage(parts[1]);
    else homePage();
  }
  window.addEventListener('hashchange', route);
  route();
})();
