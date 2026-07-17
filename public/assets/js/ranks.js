/* Shared rank list: code, default title, and insignia icon.
   Used by chain-of-command.js (render icons) and admin.js (rank dropdown + icon preview). */
const RANKS = [
  { code: "O-1", title: "2nd Lieutenant", icon: "assets/img/ranks/o1-2ndlt.png" },
  { code: "O-2", title: "1st Lieutenant", icon: "assets/img/ranks/o2-1stlt.png" },
  { code: "O-3", title: "Captain", icon: "assets/img/ranks/o3-capt.png" },
  { code: "O-4", title: "Major", icon: "assets/img/ranks/o4-major.png" },
  { code: "O-5", title: "Lieutenant Colonel", icon: "assets/img/ranks/o5-ltcol.png" },
  { code: "O-6", title: "Colonel", icon: "assets/img/ranks/o6-colonel.png" },
  { code: "O-7", title: "Brigadier General", icon: "assets/img/ranks/o7-briggen.png" },
  { code: "O-8", title: "Major General", icon: "assets/img/ranks/o8-majgen.png" },
  { code: "O-9", title: "Lieutenant General", icon: "assets/img/ranks/o9-ltgen.png" },
  { code: "CW-2", title: "Chief Warrant Officer 2", icon: "assets/img/ranks/cw2-cwo2.png" },
  { code: "CW-3", title: "Chief Warrant Officer 3", icon: "assets/img/ranks/cw3-cwo3.png" },
  { code: "CW-4", title: "Chief Warrant Officer 4", icon: "assets/img/ranks/cw4-cwo4.png" },
  { code: "CW-5", title: "Chief Warrant Officer 5", icon: "assets/img/ranks/cw5-cwo5.png" },
  { code: "WO-1", title: "Warrant Officer 1", icon: "assets/img/ranks/wo1-wo1.png" },
];

const RANK_ICONS = Object.fromEntries(RANKS.map((r) => [r.code, r.icon]));
const RANK_TITLES = Object.fromEntries(RANKS.map((r) => [r.code, r.title]));
