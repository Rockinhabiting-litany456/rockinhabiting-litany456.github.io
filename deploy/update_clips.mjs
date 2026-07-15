// hutonclips 0円自動更新スクリプト(Node 20+ / 外部ライブラリ不要)
// Twitch APIで布団ちゃん(indegnasen0706)チャンネルの全クリップを取得し、
// clips.json に書き出します。GitHub Actionsから毎日実行される想定。
//
// 必要な環境変数: TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET(README-clips.md参照)
//
// 【全件取得の仕組み】Get Clips APIは1回の検索につき最大1000件しか辿れないため、
// チャンネル開設(2022-07-30)から現在まで14日ごとの期間に区切って走査します。
// 1つの期間で1000件近く返ってきた場合は、その期間を半分に割って再取得するので
// 取り漏れがありません。毎回全期間を走査し直すため、視聴回数も毎日最新に更新され、
// 削除されたクリップは自動的にリストから消えます。

import { writeFileSync } from "fs";

const LOGIN = "indegnasen0706";
const SINCE = "2022-07-01T00:00:00Z"; // チャンネル開設より前から
const CID = process.env.TWITCH_CLIENT_ID;
const SECRET = process.env.TWITCH_CLIENT_SECRET;
if (!CID || !SECRET) {
  console.error("環境変数 TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET を設定してください(README-clips.md参照)");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// アプリトークン取得(client_credentials)
const tokRes = await fetch("https://id.twitch.tv/oauth2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: `client_id=${CID}&client_secret=${SECRET}&grant_type=client_credentials`,
});
const token = (await tokRes.json()).access_token;
if (!token) { console.error("トークン取得に失敗しました。Client ID/Secretを確認してください。"); process.exit(1); }

let requests = 0;
async function api(url) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: { "Client-Id": CID, Authorization: `Bearer ${token}` } });
    requests++;
    if (r.status === 429) { await sleep(3000); continue; } // レート制限→待って再試行
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  }
  throw new Error("リトライ上限に達しました");
}

// ブロードキャスターID取得
const users = await api(`https://api.twitch.tv/helix/users?login=${LOGIN}`);
const bid = users.data?.[0]?.id;
if (!bid) { console.error(`チャンネル ${LOGIN} が見つかりません`); process.exit(1); }

const found = new Map();

async function fetchWindow(s, e) {
  let cursor = null, got = 0;
  do {
    const u = new URL("https://api.twitch.tv/helix/clips");
    u.searchParams.set("broadcaster_id", bid);
    u.searchParams.set("first", "100");
    u.searchParams.set("started_at", new Date(s).toISOString());
    u.searchParams.set("ended_at", new Date(e).toISOString());
    if (cursor) u.searchParams.set("after", cursor);
    const j = await api(u);
    for (const c of j.data) found.set(c.id, c);
    got += j.data.length;
    cursor = j.pagination?.cursor || null;
    await sleep(80);
  } while (cursor);
  // 1000件の上限付近まで返ってきた期間は、半分に割って取り漏れを防ぐ
  if (got >= 900 && e - s > 6 * 36e5) {
    const mid = Math.floor((s + e) / 2);
    await fetchWindow(s, mid);
    await fetchWindow(mid, e);
  }
}

const DAY = 86400e3;
const start = Date.parse(SINCE);
const now = Date.now();
for (let s = start; s < now; s += 14 * DAY) {
  await fetchWindow(s, Math.min(s + 14 * DAY, now));
  process.stdout.write(`\r${new Date(Math.min(s + 14 * DAY, now)).toISOString().slice(0, 10)} まで走査 / ${found.size}件`);
}
console.log();

// game_id → ゲーム名の解決(100件ずつ)
const gameIds = [...new Set([...found.values()].map((c) => c.game_id).filter(Boolean))];
const games = {};
for (let i = 0; i < gameIds.length; i += 100) {
  const q = gameIds.slice(i, i + 100).map((g) => `id=${encodeURIComponent(g)}`).join("&");
  const j = await api(`https://api.twitch.tv/helix/games?${q}`);
  for (const g of j.data) games[g.id] = g.name;
  await sleep(80);
}

const clips = [...found.values()]
  .sort((a, b) => b.created_at.localeCompare(a.created_at))
  .map((c) => ({
    id: c.id,
    title: c.title,
    game: games[c.game_id] || "",
    created: c.created_at,
    views: c.view_count,
    duration: c.duration,
    creator: c.creator_name,
    thumb: c.thumbnail_url,
  }));

if (clips.length === 0) { console.error("クリップが0件でした。書き込みを中止します。"); process.exit(1); }

writeFileSync("clips.json", JSON.stringify({
  site: "hutonclips",
  channel: LOGIN,
  updated: new Date().toISOString(),
  clips,
}, null, 1) + "\n");
console.log(`完了: ${clips.length}件のクリップを保存(APIリクエスト${requests}回)`);
