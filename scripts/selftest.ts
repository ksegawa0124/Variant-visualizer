/**
 * 解析ロジックのセルフテスト。
 * 実際の NCBI RefSeq レコード (BRCA1 / NM_007294.4) を取得し、既知のバリアントで結果を検証する。
 *
 *   npm run selftest
 */
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

  console.log(`\n==== pass=${pass} fail=${fail} ====`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
