/**
 * 解析ロジックのセルフテスト。
 * 実際の NCBI RefSeq レコード (BRCA1 / NM_007294.4) を取得し、既知のバリアントで結果を検証する。
 *
 *   npm run selftest
 */
import {
  allGenesToTsv,
  classifyGene,
  cnvWindow,
  parseBulkCnvs,
  parseCnvPosition,
} from '../src/lib/cnv';
import { parseGenBank } from '../src/lib/genbank';
import { parseHgvsC } from '../src/lib/hgvs';
import { analyzeVariant } from '../src/lib/variant';

const ACCESSION = 'NM_007294.4';

let pass = 0;
let fail = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    pass += 1;
    console.log(`  ok    ${name}: ${String(actual)}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}: got ${String(actual)} / want ${String(expected)}`);
  }
}

async function main(): Promise<void> {
  const url =
    'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi' +
    `?db=nuccore&rettype=gb&retmode=text&id=${ACCESSION}`;
  const res = await fetch(url);
  const tx = parseGenBank(await res.text());

  console.log(
    `record ${tx.accession} gene=${tx.gene} MANE=${tx.isMane} length=${tx.sequence.length} ` +
      `CDS=${tx.cdsStart}..${tx.cdsEnd} exons=${tx.exons.length} protein=${tx.proteinId}`,
  );

  const baseline = analyzeVariant(tx, parseHgvsC('c.1='));
  check('GenBank の翻訳と一致', baseline.refProtein.replace(/\*$/, ''), tx.proteinSequence);
  check('BRCA1 タンパク質長 = 1863 aa', baseline.refProtein.replace(/\*$/, '').length, 1863);

  // [HGVS.c, 期待する consequence, 期待する HGVS.p（空文字なら表示のみ）]
  const cases: Array<[string, string, string]> = [
    ['c.68_69del', 'frameshift', 'p.(Glu23ValfsTer17)'], // 185delAG
    ['c.5266dup', 'frameshift', 'p.(Gln1756ProfsTer74)'], // 5382insC
    ['c.181T>G', 'missense', 'p.(Cys61Gly)'], // C61G
    ['c.5503C>T', 'nonsense', 'p.(Arg1835Ter)'],
    ['c.3G>A', 'start_loss', 'p.(Met1?)'],
    ['c.5586_5588del', 'inframe_deletion', ''],
    ['c.66_68dup', 'inframe_duplication', ''],
    ['c.-14T>C', 'utr5', 'p.(=)'],
    ['c.*20C>G', 'utr3', 'p.(=)'],
    ['c.81-2A>G', 'splice_site', 'p.(?)'],
    ['c.5589_5591delinsTT', 'frameshift', ''],
    ['c.68_70inv', '', ''],
    ['c.72_73insA', 'frameshift', ''],
    ['NM_007294.4(BRCA1):c.181T>G', 'missense', 'p.(Cys61Gly)'],
  ];

  for (const [hgvs, wantConsequence, wantP] of cases) {
    console.log(`\n${hgvs}`);
    try {
      const a = analyzeVariant(tx, parseHgvsC(hgvs));
      if (wantConsequence) check('consequence', a.consequence, wantConsequence);
      else console.log(`  info  consequence = ${a.consequence}`);
      if (wantP) check('HGVS.p', a.hgvsP, wantP);
      else console.log(`  info  HGVS.p = ${a.hgvsP}`);
      check(
        '変異配列長',
        a.altSequence.length,
        tx.sequence.length - a.refBases.length + a.altBases.length,
      );
      console.log(`  info  ${a.description}`);
      for (const n of a.notes) console.log(`  note  ${n}`);
    } catch (e) {
      console.log(`  FAIL  例外: ${(e as Error).message}`);
      fail += 1;
    }
  }

  // 不正な入力は明示的なエラーになること
  const errorCases = [
    'c.68C>T', // 参照塩基の不一致
    'c.99999A>T', // 範囲外
    'c.68', // 変異記載なし
    'g.43124096A>T', // 未対応の座標系
    'c.0A>T', // 存在しない位置
    'c.68insA', // 挿入は 2 位置指定が必要
  ];
  for (const hgvs of errorCases) {
    try {
      analyzeVariant(tx, parseHgvsC(hgvs));
      console.log(`\n${hgvs}\n  FAIL  エラーになるべき入力が通過しました`);
      fail += 1;
    } catch (e) {
      console.log(`\n${hgvs}\n  ok    拒否: ${(e as Error).message.slice(0, 80)}…`);
      pass += 1;
    }
  }

  // ---- CNV: 染色体位置の読み取り（1-based・両端を含む）
  console.log('\nCNV の入力解析');
  const pos = (input: string) => {
    const p = parseCnvPosition(input);
    return `${p.chrom}:${p.start}-${p.end}`;
  };
  check('chr17:43,044,295-43,125,364', pos('chr17:43,044,295-43,125,364'), 'chr17:43044295-43125364');
  check('染色体名の chr 省略・.. 区切り', pos('17:100..200'), 'chr17:100-200');
  check('空白区切り・小文字の x', pos('chrx 1000 2000'), 'chrX:1000-2000');
  check('全角数字', pos('chr1：１００－２００'), 'chr1:100-200');
  for (const bad of ['', 'foo', 'chr23:1-2', 'chrM:1-2', 'chr1:0-10', 'chr1:200-100']) {
    try {
      parseCnvPosition(bad);
      console.log(`  FAIL  拒否されるべき入力: "${bad}"`);
      fail += 1;
    } catch {
      console.log(`  ok    拒否: "${bad}"`);
      pass += 1;
    }
  }

  // ---- CNV: 表示範囲は前後 5%、染色体の端を超えない
  const win = cnvWindow({ start: 1000, end: 11000 }, 1_000_000);
  check('前後 5% の余白（下端）', win.lo, 500);
  check('前後 5% の余白（上端）', win.hi, 11500);
  check('染色体の先頭で切る', cnvWindow({ start: 100, end: 10100 }, 1_000_000).lo, 0);
  check('染色体の末尾で切る', cnvWindow({ start: 990_000, end: 999_900 }, 1_000_000).hi, 1_000_000);

  // ---- CNV: 遺伝子との位置関係（範囲 [1000, 2000)）
  const gene = (txStart: number, txEnd: number) => ({
    accession: 'NM_TEST.1',
    gene: 'TEST',
    chrom: 'chr1',
    strand: '+' as const,
    txStart,
    txEnd,
    cdsStart: txStart,
    cdsEnd: txEnd,
    exons: [{ start: txStart, end: txEnd }],
  });
  const region = { start: 1000, end: 2000 };
  for (const [name, g, want] of [
    ['範囲内に収まる', gene(1200, 1800), 'contained'],
    ['境界に一致', gene(1000, 2000), 'contained'],
    ['開始側で切断', gene(500, 1500), 'left'],
    ['終了側で切断', gene(1500, 2500), 'right'],
    ['CNV が遺伝子内', gene(500, 2500), 'spans'],
    ['左に隣接', gene(500, 1000), 'outside'],
    ['右に隣接', gene(2000, 2500), 'outside'],
  ] as const) {
    check(name, classifyGene(g, region).relation, want);
  }

  // ---- CNV: まとめて入力（1 行 1 CNV、種類は行内の語から判定）
  console.log('\nCNV のまとめて入力');
  const bulk = parseBulkCnvs(
    [
      'chr22:18,924,000-21,465,000 Loss',
      '16:29600000-30200000, gain',
      '# コメント',
      '',
      'chr17:43044295-43125364（欠失）',
      'chrX 1000 2000 dup',
      'chr1:100-200',
    ].join('\n'),
  );
  check('種類つきの行だけ読み取る', bulk.entries.length, 4);
  check(
    'Loss の判定と位置の切り出し',
    JSON.stringify(bulk.entries[0]),
    '{"position":"chr22:18,924,000-21,465,000","type":"loss"}',
  );
  check(
    'gain（小文字・カンマ区切り）',
    JSON.stringify(bulk.entries[1]),
    '{"position":"16:29600000-30200000","type":"gain"}',
  );
  check(
    '日本語の「欠失」',
    JSON.stringify(bulk.entries[2]),
    '{"position":"chr17:43044295-43125364","type":"loss"}',
  );
  check('dup は Gain', bulk.entries[3].type, 'gain');
  check('種類のない行は読み飛ばす', bulk.skipped.join('|'), 'chr1:100-200');
  check(
    '読み取った位置がそのまま解析できる',
    bulk.entries.map((e) => pos(e.position)).join(' '),
    'chr22:18924000-21465000 chr16:29600000-30200000 chr17:43044295-43125364 chrX:1000-2000',
  );

  // ---- CNV: 複数 CNV の遺伝子 TSV（CNV を示す列が付く）
  const tsv = allGenesToTsv([
    {
      no: 1,
      region: { chrom: 'chr1', start: 999, end: 2000, type: 'loss' },
      hits: [classifyGene(gene(1200, 1800), region)],
    },
    {
      no: 2,
      region: { chrom: 'chr1', start: 999, end: 2000, type: 'gain' },
      hits: [classifyGene(gene(5000, 6000), region)],
    },
  ]);
  const tsvLines = tsv.trimEnd().split('\n');
  check('TSV: ヘッダ + 範囲内の遺伝子だけ', tsvLines.length, 2);
  check('TSV: CNV 列', tsvLines[1].split('\t').slice(0, 3).join(','), '1,Loss,chr1:1000-2000');

  console.log(`\n==== pass=${pass} fail=${fail} ====`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
