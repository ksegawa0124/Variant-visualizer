/**
 * 比較結果を PNG 画像として書き出すための Canvas レンダラ。
 *
 * 画面の DOM をそのまま画像化するのではなく、同じビューデータ (seqview.ts) から
 * 描き直している。これにより配置を完全に制御でき、長い配列を折り返して
 * 高解像度（2 倍）で出力できる。
 */

import { aa3, aaClass } from './codon';
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

/** 見出し（バリアント名・変異型・HGVS.p） */
function drawHeader(l: Layout, analysis: VariantAnalysis, subtitle: string): void {
  const { ctx } = l;
  const info = CONSEQUENCE_INFO[analysis.consequence];

  ctx.fillStyle = C.text;
  ctx.font = `600 20px ${MONO}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(analysis.hgvsC, PAD, l.y + 20);
  l.y += 30;

  ctx.font = `13px ${SANS}`;
  ctx.fillStyle = C.muted;
  const line = `${subtitle}　|　${info.label}　|　${analysis.hgvsP}`;
  ctx.fillText(line, PAD, l.y + 13);
  l.y += 28;

  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, l.y + 0.5);
  ctx.lineTo(IMG_W - PAD, l.y + 0.5);
  ctx.stroke();
  l.y += 16;
}

function drawFooter(l: Layout): void {
  const { ctx } = l;
  l.y += 4;
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, l.y + 0.5);
  ctx.lineTo(IMG_W - PAD, l.y + 0.5);
  ctx.stroke();
  l.y += 16;

  ctx.font = `11px ${SANS}`;
  ctx.fillStyle = C.muted;
  ctx.fillText(
    'Genome Variant Visualizer — 配列データ: NCBI RefSeq / 研究・教育目的の配列比較であり臨床診断には使用できません',
    PAD,
    l.y + 11,
  );
  l.y += 20;
}

/** 凡例 */
function drawLegend(l: Layout, items: Array<{ label: string; fill: string; stroke?: string }>): void {
  const { ctx } = l;
  ctx.font = `11px ${SANS}`;
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
  changeClass: 'sub' | 'del' | 'ins',
  side: 'ref' | 'alt',
): void {
  const { cellW, baseH } = DNA_M;
  const kind = side === 'ref' ? (changeClass === 'ins' ? 'sub' : 'del') : changeClass;
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
  analysis: VariantAnalysis,
): void {
  const { cellW, rulerH } = DNA_M;
  ctx.font = `9px ${MONO}`;
  ctx.fillStyle = C.muted;
  ctx.textAlign = 'center';
  cells.forEach((cell, i) => {
    const show = cell.index === analysis.changeIndex || (cell.index + 1) % 10 === 0;
    if (show) {
      ctx.fillText(indexToCLabel(cell.index, analysis.transcript), x0 + i * cellW + cellW / 2, y + rulerH - 2);
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
): void {
  ctx.textAlign = 'left';
  ctx.fillStyle = C.text;
  ctx.font = `700 12px ${SANS}`;
  ctx.fillText(name, PAD, y + h / 2 - 1);
  ctx.fillStyle = C.muted;
  ctx.font = `9.5px ${MONO}`;
  const maxW = LABEL_W - 12;
  let text = sub;
  while (text.length > 4 && ctx.measureText(text).width > maxW) text = text.slice(0, -1);
  if (text !== sub) text = `${text.slice(0, -1)}…`;
  ctx.fillText(text, PAD, y + h / 2 + 12);
}

export interface DnaExportOptions {
  flank: number;
  threeLetter: boolean;
}

/** DNA 配列の比較を PNG 用の Canvas に描画する */
export function renderDnaComparison(
  analysis: VariantAnalysis,
  options: DnaExportOptions,
): HTMLCanvasElement {
  const view = buildDnaView(analysis, options.flank);
  const { cellW, rulerH, baseH, codonH, rowGap, blockGap } = DNA_M;

  const x0 = PAD + LABEL_W;
  const perLine = Math.floor((IMG_W - x0 - PAD) / cellW);
  const total = view.refCells.length;
  const lines = Math.max(1, Math.ceil(total / perLine));

  const blockH = view.intronic
    ? rulerH + baseH + codonH + rowGap
    : rulerH + (baseH + codonH) * 2 + rowGap * 3;

  const headerH = 90;
  const legendH = 26;
  const footerH = 40;
  const height = headerH + lines * (blockH + blockGap) + legendH + footerH;

  const canvas = document.createElement('canvas');
  canvas.width = IMG_W * SCALE;
  canvas.height = Math.ceil(height) * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, IMG_W, height);
  ctx.textBaseline = 'alphabetic';

  const l: Layout = { ctx, y: PAD };
  drawHeader(l, analysis, 'DNA 配列の比較');

  for (let line = 0; line < lines; line += 1) {
    const from = line * perLine;
    const to = Math.min(total, from + perLine);
    const refSlice = view.refCells.slice(from, to);
    const altSlice = view.altCells.slice(from, to);

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
    drawRuler(ctx, refSlice, x0, y, analysis);
    y += rulerH;

    drawRowLabel(ctx, '参照配列', analysis.transcript.accession, y, baseH + codonH);
    drawBaseRow(ctx, refSlice, x0, y, view.changeClass, 'ref');
    y += baseH;
    drawCodonRow(ctx, sliceGroups(view.refGroups), x0, y, options.threeLetter);
    y += codonH + rowGap;

    if (!view.intronic) {
      ctx.strokeStyle = C.border;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y - rowGap / 2 + 0.5);
      ctx.lineTo(IMG_W - PAD, y - rowGap / 2 + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);

      drawRowLabel(ctx, 'バリアント', analysis.parsed.normalized, y, baseH + codonH);
      drawBaseRow(ctx, altSlice, x0, y, view.changeClass, 'alt');
      y += baseH;
      drawCodonRow(ctx, sliceGroups(view.altGroups), x0, y, options.threeLetter);
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

/** アミノ酸配列の比較を PNG 用の Canvas に描画する */
export function renderProteinComparison(
  analysis: VariantAnalysis,
  options: { threeLetter: boolean },
): HTMLCanvasElement {
  const { positions } = buildProteinView(analysis);
  const { cellW, cellH, rulerH, rowGap, blockGap } = PROT_M;

  const x0 = PAD + LABEL_W;
  const perLine = Math.floor((IMG_W - x0 - PAD) / cellW);
  const lines = Math.max(1, Math.ceil(positions.length / perLine));
  const blockH = rulerH + cellH * 2 + rowGap;

  const headerH = 90;
  const height = headerH + lines * (blockH + blockGap) + 26 + 40;

  const canvas = document.createElement('canvas');
  canvas.width = IMG_W * SCALE;
  canvas.height = Math.ceil(height) * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, IMG_W, height);
  ctx.textBaseline = 'alphabetic';

  const l: Layout = { ctx, y: PAD };
  drawHeader(l, analysis, 'アミノ酸配列の比較');

  const refP = analysis.refProtein;
  const altP = analysis.altProtein;

  const drawResidues = (slice: number[], seq: string, y: number) => {
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
      const changed = refP[pos] !== altP[pos];
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
      if ((pos + 1) % 5 === 0 || pos + 1 === analysis.proteinChangeStart) {
        ctx.fillText(String(pos + 1), x0 + i * cellW + (cellW - 3) / 2, y + rulerH - 3);
      }
    });
    ctx.textAlign = 'left';
    y += rulerH;

    drawRowLabel(ctx, '参照', analysis.transcript.proteinId ?? '', y, cellH);
    drawResidues(slice, refP, y);
    y += cellH + rowGap;

    drawRowLabel(ctx, 'バリアント', analysis.hgvsP, y, cellH);
    drawResidues(slice, altP, y);
    y += cellH;

    l.y = y + blockGap;
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

/** ファイル名に使えない文字を置き換える */
export function safeFileName(analysis: VariantAnalysis, suffix: string): string {
  const base = `${analysis.transcript.gene}_${analysis.transcript.accession}_${analysis.parsed.normalized}`;
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
