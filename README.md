# Genome Variant Visualizer

遺伝子バリアント（HGVS.c 記法）と RefSeq 参照配列を比較し、**DNA 配列とアミノ酸配列の変化**を可視化する Web アプリです。SNV・欠失・挿入・重複・欠失挿入・逆位に対応しています。

バックエンドはありません。配列データはブラウザが NCBI の公開 API から直接取得します。

## 使い方

ホーム画面で次の項目を入力します。

| 項目 | 必須 | 説明 |
| --- | --- | --- |
| リファレンスゲノム | — | `GRCh38/hg38`（既定）または `GRCh37/hg19`。表示するゲノム座標の算出に使います |
| 参照配列 | — | `NM_007294.4` など。未指定なら遺伝子名から **MANE Select** を自動検索します |
| 遺伝子 | ✔ | HGNC 遺伝子記号（`BRCA1`, `TSC2`, `SCN4A` など） |
| バリアントの詳細 | ✔ | HGVS.c 記法（`c.68_69del` など） |

解析結果はページ上部に、次の順で表示されます。

1. **バリアント** — 参照配列・遺伝子・HGVS.c（例: `NM_007294.4(BRCA1):c.68_69del`）
2. **バリアントの簡易な説明** — 変異型と、アミノ酸配列に起きる変化の要約

続いて、転写産物とタンパク質の全体像、DNA 配列の比較、アミノ酸配列の比較が表示されます。

### 画像として書き出す

「DNA 配列の比較」「アミノ酸配列の比較」はそれぞれ **PNG 画像として保存**、または**クリップボードにコピー**できます。スライドや文書にそのまま貼り付けられるよう、画面のテーマに関わらず白背景・2 倍解像度で出力し、見出し（参照配列・遺伝子・HGVS.c・変異型・HGVS.p）と凡例を含めます。長い配列は自動的に折り返されます。

### 対応する HGVS.c 記法

| 変異型 | 例 |
| --- | --- |
| 置換 | `c.181T>G` |
| 欠失 | `c.68del` / `c.68_69del` / `c.68_69delAG` |
| 重複 | `c.5266dup` / `c.66_68dup` |
| 挿入 | `c.68_69insATG` |
| 欠失挿入 | `c.5589_5591delinsTT` |
| 逆位 | `c.68_70inv` |
| 変化なし | `c.68=` |

5′UTR（`c.-14T>C`）、3′UTR（`c.*20C>G`）、イントロン（`c.81-2A>G`）の位置指定にも対応します。
`NM_007294.4(BRCA1):c.181T>G` のように接頭辞付きで貼り付けることもできます。

## 解析の仕組み

1. 参照配列が未指定なら、NCBI E-utilities で `<遺伝子>[gene] AND "MANE Select"[keyword]` を検索し、代表転写産物を決定します。
2. 転写産物の GenBank レコード（`efetch`）を取得し、全長配列・CDS 範囲・エクソン構造・参照タンパク質を読み取ります。
3. HGVS.c の座標を転写産物座標に変換し、**入力に書かれた参照塩基が実際の配列と一致するか検証**したうえでバリアントを適用します。
4. 参照 CDS と変異後の配列をそれぞれ翻訳し、標準遺伝暗号でアミノ酸配列を比較して変異型（ミスセンス / ナンセンス / フレームシフト / インフレーム欠失 など）と HGVS.p を決定します。
   - 変異アレルは CDS 開始から転写産物の末端まで翻訳し、最初に現れた終止コドンで打ち切ります。これによりフレームシフトによる新たな終止コドンや、終止コドン消失による読み過ごしも扱えます。
5. ゲノム座標は NCBI Variation Services で HGVS.c → SPDI → 各アセンブリの染色体配列へ変換して表示します（付加情報のため、取得に失敗しても解析結果は表示されます）。

### 制限事項

- **臨床診断には使用できません。** 研究・教育目的の配列比較ツールです。
- イントロン内バリアントは、スプライス部位（±1〜2 塩基）かどうかを示すのみで、スプライシングの変化とその結果生じるタンパク質は予測しません。
- 開始コドンが失われた場合、代替開始コドンからの翻訳は予測しません。
- 5′UTR に生じた uORF/uAUG など、翻訳制御への影響は評価しません。
- 転写産物 1 本に対する解析です。選択的スプライシングによる他のアイソフォームへの影響は扱いません。
- HGVS.p は本ツールが配列比較から生成した**予測**であり、括弧付き（`p.(...)`）で表記しています。

## 開発

Node.js 20 以上が必要です。

```bash
npm install
npm run dev        # 開発サーバ (http://localhost:5173)
npm run build      # 型チェック + 本番ビルド (dist/)
npm run preview    # ビルド結果の確認
npm run selftest   # 既知のバリアントで解析ロジックを検証（要ネットワーク）
npm run lint
```

`npm run selftest` は実際の BRCA1 レコード（NM_007294.4）を取得し、`c.68_69del` → `p.(Glu23ValfsTer17)`（185delAG）、`c.5266dup` → `p.(Gln1756ProfsTer74)`（5382insC）、`c.181T>G` → `p.(Cys61Gly)` といった既知の対応関係を含む 44 項目を検証します。

### 構成

```
src/
  lib/
    codon.ts     標準遺伝暗号・アミノ酸表記
    hgvs.ts      HGVS.c 記法のパーサ
    genbank.ts   GenBank フラットファイルのパーサ
    ncbi.ts      NCBI E-utilities / Variation Services クライアント
    variant.ts   バリアントの適用と consequence 判定
    seqview.ts   配列比較ビューの組み立て（画面と画像出力で共通）
    exportImage.ts  PNG 書き出し用の Canvas レンダラ
  components/
    VariantForm.tsx     入力フォーム
    SummaryHeader.tsx   バリアントと簡易説明（ページ上部）
    OverviewMap.tsx     転写産物・タンパク質の全体像 (SVG)
    DnaCompare.tsx      DNA 配列の比較
    ProteinCompare.tsx  アミノ酸配列の比較
```

## デプロイ

`main` ブランチへの push で GitHub Actions が `dist/` をビルドし、GitHub Pages へ公開します（`.github/workflows/deploy.yml`）。

初回のみ、リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定してください。

`vite.config.ts` で `base: './'` を指定しているため、ユーザーページ・プロジェクトページのどちらでもそのまま動作します。

## データ提供元

- [NCBI E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/)（RefSeq 転写産物の配列と注釈）
- [NCBI Variation Services](https://api.ncbi.nlm.nih.gov/variation/v0/)（HGVS ↔ ゲノム座標の変換）
- [MANE](https://www.ncbi.nlm.nih.gov/refseq/MANE/)（代表転写産物の選定）
