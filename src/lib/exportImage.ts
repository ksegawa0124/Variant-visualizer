/**
 * 比較結果を PNG 画像として書き出すための Canvas レンダラ。
 *
 * 画面の DOM をそのまま画像化するのではなく、同じビューデータ (seqview.ts / compare.ts) から
 * 描き直している。これにより配置を完全に制御でき、長い配列を折り返して
 * 高解像度（2 倍）で出力できる。
 */

import { aa3, aaClass } from './codon';
import type { AnalysisRef, ComparisonRow } from './compare';
import { variantColor, variantTag } from './palette';
import { buildDnaView, buildProteinView, type CodonGroup, type Cell } from './seqview';
import { CONSEQUENCE_INFO, indexToCLabel, type VariantAnalysis } from './variant';

/** 書類やスライドに貼ることを想定し、画面のテーマに関わらず明るい配色で出力する */
const C = {
  bg: '#ffffff',
  text: '#16191f',
  muted: '#667085',
  border: '#dfe4ec',
  borderStrong: '#c4ccd9',
  panel: '#f5f7fa',
  accent: '#2563eb',
  A: '#1f9d55',
  C: '#2563eb',
  G: '#c2760a',
  T: '#d0342c',
  N: '#667085',
  subBg: '#fdf3d7',
  subLine: '#f0b429',
  delBg: '#fbe3e1',
  delLine: '#d0342c',
  insBg: '#ddf3e6',
  insLine: '#1f9d55',
  stopBg: '#3b3f46',
  aaNonpolar: '#e8edf5',
  aaPolar: '#dff0f6',
  aaAcidic: '#fbe0e0',
  aaBasic: '#e2e0fb',
  zebra: '#fafbfd',
} as const;

const MONO = '"Cascadia Mono", "Consolas", "Noto Sans Mono", ui-monospace, monospace';
const SANS = '"Hiragino Sans", "Yu Gothic", Meiryo, "Helvetica Neue", Arial, sans-serif';

/** 出力倍率（2 = Retina 相当。スライドに貼っても粗くならない） */
const SCALE = 2;

const PAD = 28;
const LABEL_W = 136;
const IMG_W = 1280;

interface Layout {
  ctx: CanvasRenderingContext2D;
  y: number;
}

function baseColor(base: string): string {
  return (C as Record<string, string>)[base] ?? C.N;
}

function aaFill(aa: string): string {
  switch (aaClass(aa)) {
    case 'polar':
      return C.aaPolar;
    case 'acidic':
      return C.aaAcidic;
    case 'basic':
      return C.aaBasic;
    case 'stop':
      return C.stopBg;
    default:
      return C.aaNonpolar;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 指定幅に収まるよう末尾を省略する */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function createCanvas(height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = IMG_W * SCALE;
  canvas.height = Math.ceil(height) * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, IMG_W, height);
  ctx.textBaseline = 'alphabetic';
  return { canvas, ctx };
}

function hr(l: Layout): void {
  l.ctx.strokeStyle = C.border;
  l.ctx.lineWidth = 1;
  l.ctx.beginPath();
  l.ctx.moveTo(PAD, l.y + 0.5);
  l.ctx.lineTo(IMG_W - PAD, l.y + 0.5);
  l.ctx.stroke();
}

const TITLE_H = 30 + 28 + 16;
const VARIANT_LINE_H = 17;

/** 見出し（対象と図の種類） */
function drawTitle(l: Layout, title: string, subtitle: string): void {
  const { ctx } = l;
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText(fitText(ctx, title, IMG_W - PAD * 2), PAD, l.y + 20);
  l.y += 30;

  ctx.font = `13px ${SANS}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(fitText(ctx, subtitle, IMG_W - PAD * 2), PAD, l.y + 13);
  l.y += 28;

  hr(l);
  l.y += 16;
}

/** 複数バリアントの凡例行（色チップ + HGVS.c + 変異型 + HGVS.p） */
function drawVariantLines(l: Layout, items: AnalysisRef[]): void {
  if (items.length < 2) return;
  const { ctx } = l;
  l.y -= 10;
  items.forEach((item, i) => {
    const a = item.analysis;
    const y = l.y + i * VARIANT_LINE_H;
    ctx.fillStyle = variantColor(item.order);
    roundRect(ctx, PAD, y + 2, 9, 9, 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = `700 11px ${SANS}`;
    ctx.fillStyle = C.text;
    ctx.fillText(variantTag(item.order), PAD + 15, y + 11);

    ctx.font = `11.5px ${MONO}`;
    ctx.fillText(a.parsed.normalized, PAD + 42, y + 11);

    ctx.font = `11px ${SANS}`;
    ctx.fillStyle = C.muted;
    const tail = `${CONSEQUENCE_INFO[a.consequence].label}　${a.hgvsP}`;
    ctx.fillText(fitText(ctx, tail, IMG_W - PAD * 2 - 230), PAD + 230, y + 11);
  });
  l.y += items.length * VARIANT_LINE_H + 8;
}

/** 見出し全体（seq 系の図で共通） */
function drawHeader(l: Layout, items: AnalysisRef[], subtitle: string): void {
  const first = items[0].analysis;
  const tx = first.transcript;
  const title =
    items.length === 1
      ? first.hgvsC
      : `${tx.accession}(${tx.gene}) — ${items.length} バリアントの比較`;
  const sub =
    items.length === 1
      ? `${subtitle}　|　${CONSEQUENCE_INFO[first.consequence].label}　|　${first.hgvsP}`
      : subtitle;
  drawTitle(l, title, sub);
  drawVariantLines(l, items);
}

function headerHeight(items: AnalysisRef[]): number {
  return TITLE_H + (items.length >= 2 ? items.length * VARIANT_LINE_H - 2 : 0);
}

function drawFooter(l: Layout): void {
  const { ctx } = l;
  l.y += 4;
  hr(l);
  l.y += 16;

  ctx.textAlign = 'left';
  ctx.font = `11px ${SANS}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(
    'Genome Variant Visualizer — 配列データ: NCBI RefSeq / 研究・教育目的の配列比較であり臨床診断には使用できません',
    PAD,
    l.y + 11,
  );
  l.y += 20;
}

const FOOTER_H = 40;

/** 凡例 */
function drawLegend(l: Layout, items: Array<{ label: string; fill: string; stroke?: string }>): void {
  const { ctx } = l;
  ctx.font = `11px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let x = PAD;
  const y = l.y + 8;
  for (const item of items) {
    ctx.fillStyle = item.fill;
    roundRect(ctx, x, y - 5, 11, 11, 2);
    ctx.fill();
    ctx.strokeStyle = item.stroke ?? C.borderStrong;
    ctx.lineWidth = 1;
    ctx.stroke();
    x += 16;
    ctx.fillStyle = C.muted;
    ctx.fillText(item.label, x, y);
    x += ctx.measureText(item.label).width + 18;
  }
  ctx.textBaseline = 'alphabetic';
  l.y += 22;
}

const LEGEND_H = 22;

interface DnaMetrics {
  cellW: number;
  rulerH: number;
  baseH: number;
  codonH: number;
  rowGap: number;
  blockGap: number;
}

const DNA_M: DnaMetrics = {
  cellW: 17,
  rulerH: 13,
  baseH: 21,
  codonH: 24,
  rowGap: 8,
  blockGap: 22,
};

/** 1 行分の塩基セルを描く */
function drawBaseRow(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  x0: number,
  y: number,
  kind: 'sub' | 'del' | 'ins',
): void {
  const { cellW, baseH } = DNA_M;
  const bg = kind === 'sub' ? C.subBg : kind === 'del' ? C.delBg : C.insBg;
  const line = kind === 'sub' ? C.subLine : kind === 'del' ? C.delLine : C.insLine;

  cells.forEach((cell, i) => {
    const x = x0 + i * cellW;
    if (cell.changed) {
      ctx.fillStyle = bg;
      roundRect(ctx, x, y, cellW, baseH, 2);
      ctx.fill();
      ctx.fillStyle = line;
      ctx.fillRect(x, y + baseH - 2, cellW, 2);
    }
    ctx.fillStyle = baseColor(cell.base);
    ctx.globalAlpha = cell.codonIndex === null ? 0.5 : 1;
    ctx.font = `600 14px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(cell.base, x + cellW / 2, y + baseH - 6);
    ctx.globalAlpha = 1;

    if (cell.changed && kind === 'del') {
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + baseH / 2);
      ctx.lineTo(x + cellW - 3, y + baseH / 2);
      ctx.stroke();
    }
  });
  ctx.textAlign = 'left';
}

/** 1 行分のコドン枠とアミノ酸を描く */
function drawCodonRow(
  ctx: CanvasRenderingContext2D,
  groups: CodonGroup[],
  x0: number,
  y: number,
  threeLetter: boolean,
): void {
  const { cellW, codonH } = DNA_M;
  let cellsDrawn = 0;
  for (const g of groups) {
    const x = x0 + cellsDrawn * cellW;
    const w = g.span * cellW;
    cellsDrawn += g.span;
    if (g.codonIndex === null) continue;

    ctx.fillStyle = g.aa === '*' ? C.stopBg : g.changed ? C.subBg : C.panel;
    roundRect(ctx, x + 0.5, y + 0.5, w - 1, codonH - 1, 3);
    ctx.fill();
    ctx.strokeStyle = g.aa === '*' ? C.stopBg : g.changed ? C.subLine : C.borderStrong;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.globalAlpha = g.partial ? 0.45 : 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = g.aa === '*' ? '#ffffff' : C.text;
    ctx.font = `${g.changed ? '700 ' : ''}11px ${MONO}`;
    const label = g.aa ? (threeLetter ? aa3(g.aa) : g.aa) : '';
    ctx.fillText(label, x + w / 2, y + 12);
    if (g.span === 3) {
      ctx.fillStyle = g.aa === '*' ? '#ffffffcc' : C.muted;
      ctx.font = `9px ${MONO}`;
      ctx.fillText(String(g.codonIndex + 1), x + w / 2, y + 21);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  cells: Cell[],
  x0: number,
  y: number,
  tx: VariantAnalysis['transcript'],
  markers: number[],
): void {
  const { cellW, rulerH } = DNA_M;
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  cells.forEach((cell, i) => {
    const show = markers.includes(cell.index) || (cell.index + 1) % 10 === 0;
    if (show) {
      ctx.fillText(indexToCLabel(cell.index, tx), x0 + i * cellW + cellW / 2, y + rulerH - 2);
    }
  });
  ctx.textAlign = 'left';
}

function drawRowLabel(
  ctx: CanvasRenderingContext2D,
  name: string,
  sub: string,
  y: number,
  h: number,
  color?: string,
): void {
  ctx.textAlign = 'left';
  let x = PAD;
  if (color) {
    ctx.fillStyle = color;
    roundRect(ctx, x, y + h / 2 - 10, 4, 14, 2);
    ctx.fill();
    x += 9;
  }
  ctx.fillStyle = C.text;
  ctx.font = `700 12px ${SANS}`;
  ctx.fillText(fitText(ctx, name, LABEL_W - 12 - (x - PAD)), x, y + h / 2 - 1);
  ctx.fillStyle = C.muted;
  ctx.font = `9.5px ${MONO}`;
  ctx.fillText(fitText(ctx, sub, LABEL_W - 12 - (x - PAD)), x, y + h / 2 + 12);
}

export interface DnaExportOptions {
  flank: number;
  threeLetter: boolean;
}

/** DNA 配列の比較を PNG 用の Canvas に描画する（バリアントは何本でも重ねられる） */
export function renderDnaComparison(
  items: AnalysisRef[],
  options: DnaExportOptions,
): HTMLCanvasElement {
  const analyses = items.map((i) => i.analysis);
  const byAnalysis = new Map(items.map((i) => [i.analysis, i]));
  const multi = items.length > 1;
  const tx = analyses[0].transcript;
  const view = buildDnaView(analyses, options.flank);
  const { cellW, rulerH, baseH, codonH, rowGap, blockGap } = DNA_M;

  const x0 = PAD + LABEL_W;
  const maxPerLine = Math.floor((IMG_W - x0 - PAD) / cellW);
  const total = view.refCells.length;
  const lines = Math.max(1, Math.ceil(total / maxPerLine));
  // 端数が 1 行に数セルだけ残らないよう、行数を決めてから均等に割り付ける
  const perLine = Math.ceil(total / lines);

  const nRows = 1 + view.rows.length;
  const blockH = rulerH + nRows * (baseH + codonH + rowGap) + blockGap - rowGap;
  const height = PAD + headerHeight(items) + lines * blockH + LEGEND_H + FOOTER_H + PAD;

  const { canvas, ctx } = createCanvas(height);
  const l: Layout = { ctx, y: PAD };
  drawHeader(l, items, 'DNA 配列の比較');

  for (let line = 0; line < lines; line += 1) {
    const from = line * perLine;
    const to = Math.min(total, from + perLine);

    // コドン枠はセル数を数えながら切り出す（枠が行をまたぐ場合は分割する）
    const sliceGroups = (groups: CodonGroup[]): CodonGroup[] => {
      const out: CodonGroup[] = [];
      let pos = 0;
      for (const g of groups) {
        const start = pos;
        const end = pos + g.span;
        pos = end;
        if (end <= from || start >= to) continue;
        const span = Math.min(end, to) - Math.max(start, from);
        out.push({ ...g, span, partial: g.partial || span < 3 });
      }
      return out;
    };

    let y = l.y;
    drawRuler(ctx, view.refCells.slice(from, to), x0, y, tx, view.markers);
    y += rulerH;

    drawRowLabel(ctx, '参照配列', tx.accession, y, baseH + codonH);
    drawBaseRow(ctx, view.refCells.slice(from, to), x0, y, view.refChangeClass);
    y += baseH;
    drawCodonRow(ctx, sliceGroups(view.refGroups), x0, y, options.threeLetter);
    y += codonH + rowGap;

    for (const row of view.rows) {
      ctx.strokeStyle = C.border;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y - rowGap / 2 + 0.5);
      ctx.lineTo(IMG_W - PAD, y - rowGap / 2 + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      const order = byAnalysis.get(row.analysis)?.order ?? 0;
      drawRowLabel(
        ctx,
        multi ? variantTag(order) : 'バリアント',
        row.analysis.parsed.normalized,
        y,
        baseH + codonH,
        multi ? variantColor(order) : undefined,
      );
      drawBaseRow(ctx, row.cells.slice(from, to), x0, y, row.changeClass);
      y += baseH;
      drawCodonRow(ctx, sliceGroups(row.groups), x0, y, options.threeLetter);
      y += codonH + rowGap;
    }

    l.y = y + blockGap - rowGap;
  }

  drawLegend(l, [
    { label: '置換された塩基', fill: C.subBg, stroke: C.subLine },
    { label: '欠失した塩基', fill: C.delBg, stroke: C.delLine },
    { label: '挿入・重複した塩基', fill: C.insBg, stroke: C.insLine },
    { label: 'アミノ酸が変化するコドン', fill: C.subBg, stroke: C.subLine },
    { label: '終止コドン', fill: C.stopBg, stroke: C.stopBg },
  ]);
  drawFooter(l);
  return canvas;
}

const PROT_M = { cellW: 34, cellH: 26, rulerH: 14, rowGap: 6, blockGap: 22 };

/** アミノ酸配列の比較を PNG 用の Canvas に描画する（バリアントは何本でも重ねられる） */
export function renderProteinComparison(
  items: AnalysisRef[],
  options: { threeLetter: boolean },
): HTMLCanvasElement {
  const multi = items.length > 1;
  const shown = items.filter((i) => i.analysis.proteinComputed);
  const targets = (shown.length > 0 ? shown : items).map((i) => i.analysis);
  const { positions, markers } = buildProteinView(targets);
  const { cellW, cellH, rulerH, rowGap, blockGap } = PROT_M;

  const x0 = PAD + LABEL_W;
  const maxPerLine = Math.floor((IMG_W - x0 - PAD) / cellW);
  const lines = Math.max(1, Math.ceil(positions.length / maxPerLine));
  const perLine = Math.ceil(positions.length / lines);
  const nRows = 1 + shown.length;
  const blockH = rulerH + nRows * (cellH + rowGap) - rowGap + blockGap;
  const height = PAD + headerHeight(items) + lines * blockH + LEGEND_H + FOOTER_H + PAD;

  const { canvas, ctx } = createCanvas(height);
  const l: Layout = { ctx, y: PAD };
  drawHeader(l, items, 'アミノ酸配列の比較');

  const refP = items[0].analysis.refProtein;

  const drawResidues = (slice: number[], seq: string, other: string, y: number) => {
    slice.forEach((pos, i) => {
      const x = x0 + i * cellW;
      const aa = seq[pos];
      if (aa === undefined) {
        // 変異側で失われた（または参照に存在しない）位置は斜線で示す
        ctx.strokeStyle = C.border;
        ctx.lineWidth = 1;
        for (let d = 0; d < cellW + cellH; d += 5) {
          ctx.beginPath();
          ctx.moveTo(x + Math.min(d, cellW - 2), y + Math.max(0, d - cellW + 2) + 2);
          ctx.lineTo(x + Math.max(0, d - cellH + 2), y + Math.min(d, cellH - 2) + 2);
          ctx.stroke();
        }
        return;
      }
      const changed = seq[pos] !== other[pos];
      ctx.fillStyle = aaFill(aa);
      roundRect(ctx, x, y, cellW - 3, cellH - 3, 3);
      ctx.fill();
      if (changed) {
        ctx.strokeStyle = C.delLine;
        ctx.lineWidth = 2;
        roundRect(ctx, x + 1, y + 1, cellW - 5, cellH - 5, 2);
        ctx.stroke();
      }
      ctx.fillStyle = aa === '*' ? '#ffffff' : C.text;
      ctx.font = `${changed ? '700 ' : ''}${options.threeLetter ? 11 : 13}px ${MONO}`;
      ctx.textAlign = 'center';
      const label = aa === '*' ? (options.threeLetter ? 'Ter' : '停') : options.threeLetter ? aa3(aa) : aa;
      ctx.fillText(label, x + (cellW - 3) / 2, y + cellH / 2 + 3);
      ctx.textAlign = 'left';
    });
  };

  for (let line = 0; line < lines; line += 1) {
    const slice = positions.slice(line * perLine, (line + 1) * perLine);
    let y = l.y;

    ctx.font = `9px ${MONO}`;
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'center';
    slice.forEach((pos, i) => {
      if ((pos + 1) % 5 === 0 || markers.includes(pos + 1)) {
        ctx.fillText(String(pos + 1), x0 + i * cellW + (cellW - 3) / 2, y + rulerH - 3);
      }
    });
    ctx.textAlign = 'left';
    y += rulerH;

    drawRowLabel(ctx, '参照', items[0].analysis.transcript.proteinId ?? '', y, cellH);
    drawResidues(slice, refP, refP, y);
    y += cellH + rowGap;

    for (const item of shown) {
      drawRowLabel(
        ctx,
        multi ? variantTag(item.order) : 'バリアント',
        item.analysis.hgvsP,
        y,
        cellH,
        multi ? variantColor(item.order) : undefined,
      );
      drawResidues(slice, item.analysis.altProtein, refP, y);
      y += cellH + rowGap;
    }

    l.y = y - rowGap + blockGap;
  }

  drawLegend(l, [
    { label: '非極性', fill: C.aaNonpolar },
    { label: '極性', fill: C.aaPolar },
    { label: '酸性', fill: C.aaAcidic },
    { label: '塩基性', fill: C.aaBasic },
    { label: '終止コドン', fill: C.stopBg, stroke: C.stopBg },
    { label: '参照と異なる残基（赤枠）', fill: '#ffffff', stroke: C.delLine },
  ]);
  drawFooter(l);
  return canvas;
}

/* ---------- 比較表 ---------- */

interface Column {
  key: keyof ComparisonRow | 'tag';
  label: string;
  w: number;
  mono?: boolean;
}

const TABLE_COLS: Column[] = [
  { key: 'tag', label: '', w: 40 },
  { key: 'gene', label: '遺伝子', w: 80 },
  { key: 'accession', label: '参照配列', w: 112, mono: true },
  { key: 'hgvsC', label: 'HGVS.c', w: 150, mono: true },
  { key: 'consequence', label: '変異型', w: 152 },
  { key: 'hgvsP', label: 'HGVS.p', w: 158, mono: true },
  { key: 'location', label: '位置', w: 152 },
  { key: 'protein', label: 'タンパク質長', w: 142 },
  { key: 'genomic', label: 'ゲノム座標', w: 238, mono: true },
];

/**
 * 全行で同じ値になる列（遺伝子・参照配列）は表から外し、副題にまとめる。
 * 同じ遺伝子のバリアントを並べることが多く、その分を他の列の幅に回せる。
 */
function layoutColumns(rows: ComparisonRow[]): { cols: Column[]; shared: string[] } {
  const same = (key: 'gene' | 'accession') =>
    rows.length > 0 && rows.every((r) => r[key] === rows[0][key]);
  const shared: string[] = [];
  const drop = new Set<string>();
  for (const key of ['gene', 'accession'] as const) {
    if (same(key)) {
      shared.push(rows[0][key]);
      drop.add(key);
    }
  }
  const kept = TABLE_COLS.filter((c) => !drop.has(c.key));
  const total = kept.reduce((s, c) => s + c.w, 0);
  const scale = (IMG_W - PAD * 2) / total;
  return { cols: kept.map((c) => ({ ...c, w: c.w * scale })), shared };
}

const TABLE_HEAD_H = 28;
const TABLE_ROW_H = 32;

/** 複数バリアントの比較表を PNG 用の Canvas に描画する */
export function renderVariantTable(rows: ComparisonRow[], subtitle: string): HTMLCanvasElement {
  const height =
    PAD + TITLE_H + TABLE_HEAD_H + rows.length * TABLE_ROW_H + 14 + FOOTER_H + PAD;

  const { cols, shared } = layoutColumns(rows);
  const { canvas, ctx } = createCanvas(height);
  const l: Layout = { ctx, y: PAD };
  drawTitle(
    l,
    `バリアント比較（${rows.length} 件）`,
    [...shared, subtitle].join('　|　'),
  );

  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const startX = PAD;

  // ヘッダ行
  ctx.fillStyle = C.panel;
  roundRect(ctx, startX, l.y, totalW, TABLE_HEAD_H, 4);
  ctx.fill();
  ctx.font = `700 11px ${SANS}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'left';
  let x = startX;
  for (const col of cols) {
    if (col.label) ctx.fillText(col.label, x + 8, l.y + 18);
    x += col.w;
  }
  l.y += TABLE_HEAD_H;

  rows.forEach((row, i) => {
    const y = l.y + i * TABLE_ROW_H;
    if (i % 2 === 1) {
      ctx.fillStyle = C.zebra;
      ctx.fillRect(startX, y, totalW, TABLE_ROW_H);
    }
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX, y + 0.5);
    ctx.lineTo(startX + totalW, y + 0.5);
    ctx.stroke();

    let cx = startX;
    for (const col of cols) {
      const textY = y + TABLE_ROW_H / 2 + 4;
      if (col.key === 'tag') {
        ctx.fillStyle = row.color;
        roundRect(ctx, cx + 8, y + 9, 22, 14, 3);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 10px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText(row.tag, cx + 19, y + 20);
        ctx.textAlign = 'left';
      } else if (col.key === 'consequence' && row.error) {
        ctx.fillStyle = C.delLine;
        ctx.font = `11px ${SANS}`;
        const w = totalW - (cx - startX) - 16;
        ctx.fillText(fitText(ctx, `解析できません: ${row.error}`, w), cx + 8, textY);
        break;
      } else {
        const value = String(row[col.key as keyof ComparisonRow] ?? '');
        ctx.fillStyle =
          col.key === 'consequence' && row.severity === 'high' ? C.delLine : C.text;
        ctx.font = col.mono ? `11px ${MONO}` : `11.5px ${SANS}`;
        ctx.fillText(fitText(ctx, value, col.w - 14), cx + 8, textY);
      }
      cx += col.w;
    }
  });

  l.y += rows.length * TABLE_ROW_H;
  ctx.strokeStyle = C.border;
  ctx.beginPath();
  ctx.moveTo(startX, l.y + 0.5);
  ctx.lineTo(startX + totalW, l.y + 0.5);
  ctx.stroke();
  l.y += 14;

  drawFooter(l);
  return canvas;
}

/** ファイル名に使えない文字を置き換える */
export function safeFileName(items: AnalysisRef[], suffix: string): string {
  const tx = items[0].analysis.transcript;
  const label =
    items.length === 1 ? items[0].analysis.parsed.normalized : `${items.length}variants`;
  const base = `${tx.gene}_${tx.accession}_${label}`;
  return `${base.replace(/[^A-Za-z0-9_.+-]/g, '_')}_${suffix}.png`;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('画像の生成に失敗しました。'));
    }, 'image/png');
  });
}

/** PNG としてダウンロードする */
export async function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await toBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Safari などで click 直後に revoke すると保存が中断されるため少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** PNG をクリップボードにコピーする（スライドや文書へそのまま貼り付けられる） */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('このブラウザは画像のクリップボードコピーに対応していません。');
  }
  const blob = await toBlob(canvas);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}
