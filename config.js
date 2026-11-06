// Edit this file to point the app at your own accounts and content.
window.UK_CONFIG = {
  appName: 'Big Blue Hub',
  teamId: '96', // ESPN team id for Kentucky (a sport can override it with its own teamId)

  // Every team the app supports. Viewers pick which ones they see on the Settings page;
  // `on: true` marks the default picks. x / ig are the team's official social accounts.
  // `sec` is ESPN's standings group id for the SEC in that sport.
  sports: [
    { key: 'mbb', label: "Men's Basketball", short: 'MBB', path: 'basketball/mens-college-basketball', sec: '23', on: true, x: 'KentuckyMBB', ig: 'kentuckymbb' },
    { key: 'football', label: 'Football', short: 'FB', path: 'football/college-football', sec: '8', on: true, x: 'UKFootball', ig: 'ukfootball' },
    { key: 'baseball', label: 'Baseball', short: 'BSB', path: 'baseball/college-baseball', teamId: '82', sec: '27', on: true, x: 'UKBaseball', ig: 'kentuckybaseball' },
    { key: 'wvb', label: "Women's Volleyball", short: 'WVB', path: 'volleyball/womens-college-volleyball', sec: '71', on: true, x: 'KentuckyVB', ig: 'kentuckyvolleyball' },
    { key: 'wbb', label: "Women's Basketball", short: 'WBB', path: 'basketball/womens-college-basketball', sec: '23', on: false, x: 'KentuckyWBB', ig: 'kentuckywbb' },
  ],

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
