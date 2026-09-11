/**
 * 配列比較ビューの組み立て。
 * 画面表示（React）と画像出力（Canvas）の両方が同じデータを使うために共通化している。
 *
 * 参照配列 1 本に対して複数のバリアントを重ねられるよう、すべて配列で受け取る。
 * バリアントが 1 つの場合も同じ経路を通る（分岐を増やさないため）。
 */

import type { VariantAnalysis } from './variant';

export interface Cell {
  base: string;
  /** その配列上の 0-based インデックス */
  index: number;
  /** CDS 内なら 0-based のコドン番号、UTR なら null */
  codonIndex: number | null;
  /** バリアントによって変化した塩基か */
  changed: boolean;
}

export interface CodonGroup {
  codonIndex: number | null;
  /** 占有する塩基セル数（1〜3） */
  span: number;
  aa: string | null;
  /** 比較相手とアミノ酸が異なるか */
  changed: boolean;
  /** 表示範囲の端で 3 塩基揃っていないコドン */
  partial: boolean;
}

export interface DnaRow {
  analysis: VariantAnalysis;
  cells: Cell[];
  groups: CodonGroup[];
  /** 変化の種類（ハイライトの色分けに使う） */
  changeClass: 'sub' | 'del' | 'ins';
  /** イントロン内バリアント（変異側の配列を表示できない） */
  intronic: boolean;
}

export interface DnaView {
  winStart: number;
  refCells: Cell[];
  refGroups: CodonGroup[];
  /**
   * 参照側ハイライトの種類。実際に塩基が失われる変異が 1 つでもあれば 'del'
   * （取り消し線つき）、置換・挿入だけなら 'sub'。
   */
  refChangeClass: 'sub' | 'del';
  /** 表示できるバリアント行（イントロン内バリアントは除外される） */
  rows: DnaRow[];
  /** 目盛りで強調する 0-based 位置 */
  markers: number[];
  /** イントロン内などで配列を描けなかったバリアント */
  omitted: VariantAnalysis[];
  /** 変異位置が離れすぎて 1 画面に収まらない（呼び出し側で注意を促す） */
  tooWide: boolean;
}

/** 1 枚の図に収める塩基数の上限。これを超えると読み取れない */
const MAX_CELLS = 600;

/**
 * すべての変異位置が 1 つのウィンドウに収まるか。
 * 収まらない場合は重ね合わせをやめて 1 件ずつ表示する（図を作る前に判定する）。
 */
export function dnaViewFits(analyses: VariantAnalysis[], flank: number): boolean {
  if (analyses.length <= 1) return true;
  const first = Math.min(...analyses.map((a) => a.changeIndex));
  const last = Math.max(
    ...analyses.map((a) => a.changeIndex + Math.max(a.refBases.length, a.altBases.length)),
  );
  return last - first + flank * 2 <= MAX_CELLS;
}

function buildCells(
  seq: string,
  winStart: number,
  count: number,
  cdsStart: number,
  cdsEndExclusive: number,
  changeFrom: number,
  changeTo: number,
): Cell[] {
  const cells: Cell[] = [];
  for (let i = winStart; i < Math.min(seq.length, winStart + count); i += 1) {
    const inCds = i >= cdsStart - 1 && i < cdsEndExclusive;
    cells.push({
      base: seq[i],
      index: i,
      codonIndex: inCds ? Math.floor((i - (cdsStart - 1)) / 3) : null,
      changed: i >= changeFrom && i < changeTo,
    });
  }
  return cells;
}

/** protein と others のいずれかで異なるコドンに changed を立てる */
function groupCodons(cells: Cell[], protein: string, others: string[]): CodonGroup[] {
  const groups: CodonGroup[] = [];
  for (const cell of cells) {
    const last = groups[groups.length - 1];
    const sameGroup =
      last !== undefined &&
      last.codonIndex === cell.codonIndex &&
      (cell.codonIndex !== null || last.codonIndex === null);
    if (sameGroup) {
      last.span += 1;
      continue;
    }
    const ci = cell.codonIndex;
    const aa = ci !== null ? (protein[ci] ?? null) : null;
    groups.push({
      codonIndex: ci,
      span: 1,
      aa,
      changed:
        ci !== null && others.some((o) => (o[ci] ?? '') !== (protein[ci] ?? '')),
      partial: false,
    });
  }
  for (const g of groups) {
    if (g.codonIndex !== null && g.span < 3) g.partial = true;
  }
  return groups;
}

function isIntronic(a: VariantAnalysis): boolean {
  return a.consequence === 'intronic' || a.consequence === 'splice_site';
}

/**
 * 変異位置の前後 flank 塩基を切り出した DNA 比較ビューを作る。
 * 複数バリアントを渡した場合は、すべての変異位置を含む 1 つのウィンドウに揃える
 * （同じ列に同じ参照座標が並ぶため、バリアント同士を直接見比べられる）。
 */
export function buildDnaView(analyses: VariantAnalysis[], flank: number): DnaView {
  if (analyses.length === 0) throw new Error('バリアントが指定されていません。');
  const tx = analyses[0].transcript;

  // ウィンドウ開始をコドン境界に揃える（読み枠が視覚的に一致するように）
  const firstChange = Math.min(...analyses.map((a) => a.changeIndex));
  let winStart = Math.max(0, firstChange - flank);
  const cdsOffset = tx.cdsStart - 1;
  if (winStart > cdsOffset) {
    winStart -= (winStart - cdsOffset) % 3;
  }

  const lastChange = Math.max(
    ...analyses.map((a) => a.changeIndex + Math.max(a.refBases.length, a.altBases.length)),
  );
  const wanted = lastChange - winStart + flank;
  const tooWide = wanted > MAX_CELLS;
  const count = Math.min(wanted, MAX_CELLS);

  // 参照側のハイライトは「いずれかのバリアントが触れる塩基」
  const refChangeFrom = firstChange;
  const refChangeTo = Math.max(...analyses.map((a) => a.changeIndex + a.refBases.length));

  const refCells = buildCells(
    tx.sequence,
    winStart,
    count,
    tx.cdsStart,
    tx.cdsEnd,
    refChangeFrom,
    refChangeTo,
  );

  const shown = analyses.filter((a) => !isIntronic(a));
  const altProteins = shown.map((a) => a.altProtein);

  const rows: DnaRow[] = analyses.flatMap((a) => {
    if (isIntronic(a)) return [];
    const cells = buildCells(
      a.altSequence,
      winStart,
      count,
      a.altCdsStart,
      a.altCdsStart - 1 + a.altProtein.length * 3,
      a.changeIndex,
      a.changeIndex + a.altBases.length,
    );
    return [
      {
        analysis: a,
        cells,
        groups: groupCodons(cells, a.altProtein, [a.refProtein]),
        changeClass:
          a.altBases.length > a.refBases.length
            ? ('ins' as const)
            : a.altBases.length < a.refBases.length
              ? ('del' as const)
              : ('sub' as const),
        intronic: false,
      },
    ];
  });

  return {
    winStart,
    refCells,
    refGroups: groupCodons(refCells, analyses[0].refProtein, altProteins),
    refChangeClass: analyses.some((a) => a.refBases.length > a.altBases.length) ? 'del' : 'sub',
    rows,
    markers: analyses.map((a) => a.changeIndex),
    omitted: analyses.filter(isIntronic),
    tooWide,
  };
}

export interface ProteinView {
  /** 表示するアミノ酸の 0-based 位置 */
  positions: number[];
  /** 変化開始位置（1-based）。目盛りの強調に使う */
  markers: number[];
  /** 変化位置が離れすぎて 1 画面に収まらない */
  tooWide: boolean;
}

const MAX_RESIDUES = 400;

/** アミノ酸側でも同様に、変化位置がすべて 1 つのウィンドウに収まるかを判定する */
export function proteinViewFits(analyses: VariantAnalysis[]): boolean {
  return analyses.length <= 1 || !buildProteinView(analyses).tooWide;
}

/** 変化位置を中心にしたアミノ酸比較ビューを作る（複数バリアントは範囲を統合する） */
export function buildProteinView(analyses: VariantAnalysis[]): ProteinView {
  const before = 12;
  let start = Infinity;
  let end = 0;

  for (const a of analyses) {
    const anchor = (a.proteinChangeStart ?? 1) - 1;
    // フレームシフト・読み過ごしでは参照配列と異なる部分が長く続くため広めに表示する
    const after = a.consequence === 'frameshift' || a.consequence === 'stop_loss' ? 36 : 12;
    start = Math.min(start, Math.max(0, anchor - before));
    end = Math.max(
      end,
      Math.min(Math.max(a.refProtein.length, a.altProtein.length), anchor + after + 1),
    );
  }

  const tooWide = end - start > MAX_RESIDUES;
  if (tooWide) end = start + MAX_RESIDUES;

  const positions: number[] = [];
  for (let i = start; i < end; i += 1) positions.push(i);
  return {
    positions,
    markers: analyses.flatMap((a) => (a.proteinChangeStart === null ? [] : [a.proteinChangeStart])),
    tooWide,
  };
}
