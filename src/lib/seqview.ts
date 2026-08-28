/**
 * 配列比較ビューの組み立て。
 * 画面表示（React）と画像出力（Canvas）の両方が同じデータを使うために共通化している。
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
  /** 参照側とアミノ酸が異なるか */
  changed: boolean;
  /** 表示範囲の端で 3 塩基揃っていないコドン */
  partial: boolean;
}

export interface DnaView {
  winStart: number;
  refCells: Cell[];
  altCells: Cell[];
  refGroups: CodonGroup[];
  altGroups: CodonGroup[];
  /** 変化の種類（ハイライトの色分けに使う） */
  changeClass: 'sub' | 'del' | 'ins';
  /** イントロン内バリアント（変異側の配列を表示できない） */
  intronic: boolean;
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

function groupCodons(cells: Cell[], protein: string, otherProtein: string): CodonGroup[] {
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
    const aa = cell.codonIndex !== null ? (protein[cell.codonIndex] ?? null) : null;
    groups.push({
      codonIndex: cell.codonIndex,
      span: 1,
      aa,
      changed:
        cell.codonIndex !== null &&
        (protein[cell.codonIndex] ?? '') !== (otherProtein[cell.codonIndex] ?? ''),
      partial: false,
    });
  }
  for (const g of groups) {
    if (g.codonIndex !== null && g.span < 3) g.partial = true;
  }
  return groups;
}

/** 変異位置の前後 flank 塩基を切り出した DNA 比較ビューを作る */
export function buildDnaView(analysis: VariantAnalysis, flank: number): DnaView {
  const tx = analysis.transcript;
  const refLen = analysis.refBases.length;
  const altLen = analysis.altBases.length;

  // ウィンドウ開始をコドン境界に揃える（読み枠が視覚的に一致するように）
  let winStart = Math.max(0, analysis.changeIndex - flank);
  const cdsOffset = tx.cdsStart - 1;
  if (winStart > cdsOffset) {
    winStart -= (winStart - cdsOffset) % 3;
  }
  const count = Math.max(refLen, altLen) + (analysis.changeIndex - winStart) + flank;

  const refCells = buildCells(
    tx.sequence,
    winStart,
    count,
    tx.cdsStart,
    tx.cdsEnd,
    analysis.changeIndex,
    analysis.changeIndex + refLen,
  );
  const altCells = buildCells(
    analysis.altSequence,
    winStart,
    count,
    analysis.altCdsStart,
    analysis.altCdsStart - 1 + analysis.altProtein.length * 3,
    analysis.changeIndex,
    analysis.changeIndex + altLen,
  );

  return {
    winStart,
    refCells,
    altCells,
    refGroups: groupCodons(refCells, analysis.refProtein, analysis.altProtein),
    altGroups: groupCodons(altCells, analysis.altProtein, analysis.refProtein),
    changeClass: altLen > refLen ? 'ins' : altLen < refLen ? 'del' : 'sub',
    intronic: analysis.consequence === 'intronic' || analysis.consequence === 'splice_site',
  };
}

export interface ProteinView {
  /** 表示するアミノ酸の 0-based 位置 */
  positions: number[];
}

/** 変化位置を中心にしたアミノ酸比較ビューを作る */
export function buildProteinView(analysis: VariantAnalysis): ProteinView {
  const anchor = (analysis.proteinChangeStart ?? 1) - 1;
  const before = 12;
  // フレームシフト・読み過ごしでは参照配列と異なる部分が長く続くため広めに表示する
  const after =
    analysis.consequence === 'frameshift' || analysis.consequence === 'stop_loss' ? 36 : 12;
  const start = Math.max(0, anchor - before);
  const end = Math.min(
    Math.max(analysis.refProtein.length, analysis.altProtein.length),
    anchor + after + 1,
  );

  const positions: number[] = [];
  for (let i = start; i < end; i += 1) positions.push(i);
  return { positions };
}
