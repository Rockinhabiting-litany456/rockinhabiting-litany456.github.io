# hutonclips — 布団ちゃんTwitchクリップまとめサイト

すべて**0円**で運用できる構成です。

- クリップ再生: Twitch公式の埋め込みプレーヤー(無料・再生は本家にカウント)
- サイト公開: GitHub Pages(無料)
- クリップ自動収集: GitHub Actions + Twitch API(無料登録)
- Good/Badスタンプの共有: Firebase Realtime Database(無料枠)

## ファイル構成

- `hutonclips.dc.html` … サイト本体
- `clips.json` … クリップ一覧(自動更新の対象。いまはサンプル3件)
- `firebase-config.js` … Good/Bad共有の設定(URLを1行貼るだけ)
- `deploy/update_clips.mjs` … 全クリップ収集スクリプト
- `deploy/update-clips.yml` … 毎日実行するスケジュール設定

## 1. サイトの公開(GitHub Pages)

MADサイト(hutonmad)と同じリポジトリに置いてもOKですし、別リポジトリでもOKです。

1. GitHubで「New repository」→ 名前 `hutonclips` → Public で作成
2. ファイルをアップロード(`deploy/update-clips.yml` は `.github/workflows/update-clips.yml` の場所に置く)
3. Settings → Pages → Branch を `main` にして Save
4. 数分後 `https://ユーザー名.github.io/hutonclips/` で公開

※Twitchの埋め込みは公開ドメインでしか動かないため、**再生の確認は公開後に**行ってください。

## 2. クリップの自動収集(Twitch API)

1. https://dev.twitch.tv/console にTwitchアカウントでログイン(要・2段階認証)
2. 「アプリケーションを登録」:
   - 名前: 任意(例 hutonclips)
   - OAuthのリダイレクトURL: `http://localhost`
   - カテゴリー: Website Integration / クライアントタイプ: 機密
3. 発行された「クライアントID」と「新しい秘密」(シークレット)をコピー
4. GitHubリポジトリの Settings → Secrets and variables → Actions → New repository secret で2つ登録:
   - `TWITCH_CLIENT_ID` = クライアントID
   - `TWITCH_CLIENT_SECRET` = シークレット
5. Actionsタブ → 「update clips」→ Run workflow で初回実行
   → **チャンネル開設から現在までの全クリップ**が `clips.json` に入ります

以後、毎朝5:30に自動更新されます。

【全件取得について】TwitchのAPIは1回の検索で最大1000件までしか返さない仕様のため、
このスクリプトは全期間を14日ごとに区切って走査し、1000件に達した期間は自動で
さらに分割します。これでクリップを漏れなく回収できます。また毎回全期間を走査し直す
ので、視聴回数は毎日最新化され、削除されたクリップは自動で消えます。

## 3. Firebaseの設定(リアクション・コメントを全視聴者で共有)

1. https://console.firebase.google.com → 「プロジェクトを作成」(名前は任意、Google Analyticsは無効でOK)
2. 左メニュー「構築」→「Realtime Database」→「データベースを作成」
   - ロケーション: シンガポール(asia-southeast1)がおすすめ
   - 「ロックモード」で開始
3. 「ルール」タブを開き、以下に置き換えて「公開」:

```json
{
  "rules": {
    "clips": {
      ".read": true,
      "$clip": {
        "good": { ".write": true, ".validate": "newData.isNumber() && newData.val() >= 0 && (newData.val() - (data.exists() ? data.val() : 0) === 1 || newData.val() - (data.exists() ? data.val() : 0) === -1)" },
        "bad": { ".write": true, ".validate": "newData.isNumber() && newData.val() >= 0 && (newData.val() - (data.exists() ? data.val() : 0) === 1 || newData.val() - (data.exists() ? data.val() : 0) === -1)" },
        "q": { ".write": true, ".validate": "newData.isNumber() && newData.val() >= 0 && (newData.val() - (data.exists() ? data.val() : 0) === 1 || newData.val() - (data.exists() ? data.val() : 0) === -1)" },
        "xq": { ".write": true, ".validate": "newData.isNumber() && newData.val() >= 0 && (newData.val() - (data.exists() ? data.val() : 0) === 1 || newData.val() - (data.exists() ? data.val() : 0) === -1)" },
        "mu": { ".write": true, ".validate": "newData.isNumber() && newData.val() >= 0 && (newData.val() - (data.exists() ? data.val() : 0) === 1 || newData.val() - (data.exists() ? data.val() : 0) === -1)" },
        "$other": { ".validate": false }
      }
    },
    "comments": {
      ".read": true,
      "$clip": {
        "$comment": {
          ".write": "!data.exists()",
          ".validate": "newData.hasChildren(['n','t','at']) && newData.child('n').isString() && newData.child('n').val().length >= 1 && newData.child('n').val().length <= 30 && newData.child('t').isString() && newData.child('t').val().length >= 1 && newData.child('t').val().length <= 500 && newData.child('at').isNumber()"
        }
      }
    }
  }
}
```

(意味: 読み取りは誰でも可。書き込みは「リアクション5種(good/bad/q=?/xq=!?/mu=♪)を±1する」操作と「コメントの新規投稿」だけ許可。既存コメントの編集・削除は不可)

4. 「データ」タブ上部に表示されるURL(`https://〜.firebasedatabase.app`)をコピー
5. `firebase-config.js` を開き、URLを貼り付け:

```js
window.HUTONCLIPS_DB_URL = "https://あなたのDB.firebasedatabase.app";
```

これで全視聴者のリアクション(Good/Bad/?/!?/♪)とコメントが共有されます。無料枠(同時接続100・転送10GB/月)で十分収まります。

## ランキングの仕様

- 総合スコア = リアクションの総量(Good+Bad+?+!?+♪) の順。同点は視聴回数→新しさで順位付け
- 週間 = 過去7日 / 月間 = 過去30日に作られたクリップが対象
- 「期間指定」で 2026/03〜2026/05 のような月範囲の振り返りが可能

## 注意

- 非公式ファンサイトである旨をサイト内に表示しています
- リアクションの二重投票は端末単位で防止(完全な防止ではありません)
- 不適切なコメントは Firebaseコンソールの「データ」タブ → comments から直接削除できます
