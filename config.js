// Edit this file to point the app at your own accounts and content.
window.UK_CONFIG = {
  appName: 'Big Blue Hub',
  teamId: '96', // ESPN team id for Kentucky (a sport can override it with its own teamId)

  // Every team the app supports. Viewers pick which ones they see on the Settings page;
  // `on: true` marks the default picks. `emoji` labels the sport on game cards. x / ig / fb are the team's official social accounts.
  // `sec` is ESPN's standings group id for the SEC in that sport. `ukSport` is the sport's id on
  // UKAthletics.com (for official news). `radio` is 'all' when every game is on the UK Sports Network
  // or 'select' when only some are. `weather: true` shows the game-day forecast (outdoor sports).
  sports: [
    { key: 'mbb', label: "Men's Basketball", short: 'MBB', emoji: '🏀', path: 'basketball/mens-college-basketball', sec: '23', on: true, ukSport: 130, radio: 'all', x: 'KentuckyMBB', fb: 'KentuckyMBB', ig: 'kentuckymbb' },
    { key: 'football', label: 'Football', short: 'FB', emoji: '🏈', path: 'football/college-football', sec: '8', on: true, ukSport: 115, radio: 'all', weather: true, x: 'UKFootball', fb: 'KentuckyFootball', ig: 'ukfootball' },
    { key: 'baseball', label: 'Baseball', short: 'BSB', emoji: '⚾️', path: 'baseball/college-baseball', teamId: '82', sec: '27', on: true, ukSport: 105, radio: 'all', weather: true, x: 'UKBaseball', fb: 'UKBaseball', ig: 'kentuckybaseball' },
    { key: 'wvb', label: 'Volleyball', short: 'WVB', emoji: '🏐', path: 'volleyball/womens-college-volleyball', sec: '71', on: true, ukSport: 118, radio: 'select', x: 'KentuckyVB', fb: 'KentuckyVolleyball', ig: 'kentuckyvolleyball' },
    { key: 'wbb', label: "Women's Basketball", short: 'WBB', emoji: '🏀', path: 'basketball/womens-college-basketball', sec: '23', on: false, ukSport: 109, radio: 'all', x: 'KentuckyWBB', fb: 'KentuckyWBB', ig: 'kentuckywbb' },
  ],

  // Championship counts shown on each team page. Update these when Kentucky wins another one.
  titlesAsOf: 'Through the 2025–26 seasons',
  titles: {
    mbb: [
      { label: 'NCAA championships', count: 8, note: '1948, 1949, 1951, 1958, 1978, 1996, 1998, 2012' },
      { label: 'SEC regular-season titles', count: 49, note: 'Most recent: 2020' },
      { label: 'SEC tournament titles', count: 32, note: 'Most recent: 2018' },
    ],
    football: [
      { label: 'National championships', count: 1, note: '1950 (claimed; college football has no official NCAA title)' },
      { label: 'SEC championships', count: 2, note: '1950, 1976' },
    ],
    baseball: [
      { label: 'NCAA championships', count: 0 },
      { label: 'SEC regular-season titles', count: 2, note: '2006, 2024' },
      { label: 'SEC tournament titles', count: 0 },
    ],
    wvb: [
      { label: 'NCAA championships', count: 1, note: '2020 (played in spring 2021)' },
      { label: 'SEC regular-season titles', count: 14, note: '1979, 1980, 1983, 1987, 1988, 2017–2025' },
      { label: 'SEC tournament titles', count: 6, note: 'Most recent: 2025' },
    ],
    wbb: [
      { label: 'NCAA championships', count: 0 },
      { label: 'SEC regular-season titles', count: 1, note: '2012' },
      { label: 'SEC tournament titles', count: 2, note: '1982, 2022' },
    ],
  },

  // Official UK Athletics news (UKAthletics.com allows other sites to read its news list).
  ukAthletics: 'https://ukathletics.com',
  // Our Cloudflare relay that returns a UK story's text, photos and video (see relay/worker.js).
  // Leave it empty and UK stories show their photo with a link to UKAthletics.com instead.
  ukRelay: 'https://bigbluehub-relay.keith-fa1.workers.dev',

  // Free live radio: the UK Sports Network streams every broadcast on WLAP 630 through iHeartRadio.
  radio: { label: 'UK Sports Network', station: 'WLAP 630', url: 'https://www.iheart.com/live/newsradio-630-wlap-965/' },

  // Department-wide accounts, always shown alongside the chosen teams' accounts.
  xHandles: ['UKAthletics'],

  instagram: {
    profiles: ['ukathletics'],
    // Instagram has no official "whole profile" embed. Paste individual post URLs here
    // (e.g. 'https://www.instagram.com/p/XXXXXXXXX/') and they render as embeds.
    posts: [],
    // Optional: a third-party feed widget URL (Behold, LightWidget, SnapWidget, etc.)
    // that renders a full profile grid in an iframe.
    widgetUrl: '',
  },

  youtube: {
    // Optional: a YouTube playlist id to embed (e.g. your channel's uploads playlist —
    // take your channel id "UCxxxx" and change the leading "UC" to "UU").
    playlistId: '',
  },

  // Where each network can be watched. YouTube TV can't be embedded in other sites
  // (it's DRM-protected and blocks iframes), so these open the service directly.
  watch: {
    youtubeTv: ['ESPN', 'ESPN2', 'ESPNU', 'ESPNEWS', 'SEC Network', 'SECN', 'ABC', 'CBS', 'CBSSN', 'FOX', 'FS1', 'NBC', 'TNT', 'truTV', 'ACC Network', 'Big Ten Network', 'BTN'],
    links: {
      youtubeTv: 'https://tv.youtube.com/live',
      'SECN+': 'https://www.espn.com/watch/',
      'ESPN+': 'https://www.espn.com/watch/',
      'Disney+': 'https://www.disneyplus.com/',
      Peacock: 'https://www.peacocktv.com/',
      'Paramount+': 'https://www.paramountplus.com/',
      'Prime Video': 'https://www.amazon.com/primevideo',
      Netflix: 'https://www.netflix.com/',
    },
  },
};
