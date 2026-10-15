/**
 * 染色体上の位置を UCSC Genome Browser 風に描く SVG を組み立てる。
 *
 * 上から順に、拡大していく 3 段構成になっている。
 *   1. 染色体 … バンド付きのイディオグラム。遺伝子の位置を枠で囲む
 *   2. 遺伝子領域 … 転写産物全体のエクソン・イントロン構造とバリアント位置
 *   3. 変異の周辺 … 選択中のバリアント付近を数百 bp 幅まで拡大
 *
 * 画面（CSS 変数でテーマに追従）と PNG 書き出し（固定の配色）の両方が
 * 同じ関数を通るので、2 つの見た目が食い違うことはない。
 * 座標はすべて UCSC に合わせた 0-based・半開区間 [start, end)。
 */

import type { Chromosome, GeneLayout } from './ucsc';

export interface MapVariant {
  id: string;
  /** 入力順（色とタグの割り当てに使う） */
  order: number;
  /** 複数バリアントのときだけ付ける "V1" など */
  tag: string | null;
  /** 例: "c.181T>G" */
  label: string;
  color: string;
  accession: string;
  /** 0-based・半開区間 */
  start: number;
  end: number;
}

export interface MapTheme {
  text: string;
  muted: string;
  line: string;
  /** エクソン・イントロンの色 */
  gene: string;
  /** バンドの縁取りや枠線 */
  outline: string;
}

export const SCREEN_THEME: MapTheme = {
  text: 'var(--text)',
  muted: 'var(--muted)',
  line: 'var(--border-strong)',
  gene: 'var(--text)',
  outline: 'var(--text)',
};

export const PRINT_THEME: MapTheme = {
  text: '#16191f',
  muted: '#667085',
  line: '#c4ccd9',
  gene: '#1f2937',
  outline: '#16191f',
};

export interface MapModel {
  chromosome: Chromosome;
  /** 取得できなかった場合は null（イディオグラムとバリアントだけを描く） */
  layout: GeneLayout | null;
  /** この染色体上にあるすべてのバリアント */
  variants: MapVariant[];
  activeId: string;
}

export interface MapOptions {
  theme: MapTheme;
  /** PNG 用の見出しと凡例を付ける */
  header?: { title: string; subtitle: string };
  legend?: boolean;
}

export interface RenderedMap {
  svg: string;
  width: number;
  height: number;
}

// ---------- 定数 ----------

const W = 960;
const LEFT = 128;
const RIGHT = 16;
const CW = W - LEFT - RIGHT;
const GAP = 24;
const CHIP_H = 15;
const FONT = "'Helvetica Neue', Arial, 'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif";

/** 近くのバリアントをまとめて「変異の周辺」の窓に入れる距離 */
const CLUSTER_BP = 2000;
/** 「変異の周辺」の最小幅（bp） */
const MIN_LOCAL_BP = 240;

const STAIN: Record<string, string> = {
  gneg: '#f7f8fa',
  gpos25: '#d5d8de',
  gpos50: '#a9aeb8',
  gpos75: '#7b818d',
  gpos100: '#454a54',
  gvar: '#c9cfe6',
  stalk: '#9aa3cf',
  acen: '#c0504d',
};

// ---------- 小道具 ----------

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);
const n1 = (n: number) => String(Math.round(n * 10) / 10);
const commas = (n: number) => Math.round(n).toLocaleString('en-US');

export function formatSpan(bp: number): string {
  if (bp >= 1e6) return `${(bp / 1e6).toFixed(bp >= 1e7 ? 0 : 1)} Mb`;
  if (bp >= 1e3) return `${(bp / 1e3).toFixed(bp >= 1e4 ? 0 : 1)} kb`;
  return `${Math.round(bp)} bp`;
}

/** UCSC 形式の表記（1-based・両端を含む）。例: chr17:43,044,295-43,125,364 */
export function formatRange(chrom: string, start: number, end: number): string {
  if (end - start <= 1) return `${chrom}:${commas(start + 1)}`;
  return `${chrom}:${commas(start + 1)}-${commas(end)}`;
}

/** 染色体番号 + バンド名。例: 17q21.31 */
export function cytobandLabel(chromosome: Chromosome, lo: number, hi: number): string {
  const num = chromosome.name.replace(/^chr/, '');
  const hit = chromosome.bands.filter((b) => b.end > lo && b.start < hi);
  if (hit.length === 0) return num;
  const first = hit[0].name;
  const last = hit[hit.length - 1].name;
  return first === last ? `${num}${first}` : `${num}${first}–${last}`;
}

function niceStep(span: number, target: number): number {
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

type Scale = (pos: number) => number;

function makeScale(lo: number, hi: number): Scale {
  return (pos) => LEFT + ((pos - lo) / (hi - lo)) * CW;
}

const clampX = (x: number) => Math.min(LEFT + CW, Math.max(LEFT, x));

// ---------- 部品 ----------

function text(
  x: number,
  y: number,
  s: string,
  fill: string,
  size = 10,
  extra = '',
): string {
  return `<text x="${n1(x)}" y="${n1(y)}" font-size="${size}" style="fill:${fill}" ${extra}>${esc(s)}</text>`;
}

function ruler(out: string[], x: Scale, lo: number, hi: number, y: number, theme: MapTheme): void {
  const step = niceStep(hi - lo, 6);
  out.push(
    `<line x1="${LEFT}" x2="${LEFT + CW}" y1="${y}" y2="${y}" style="stroke:${theme.line};stroke-width:1"/>`,
  );
  for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
    const px = x(p);
    out.push(
      `<line x1="${n1(px)}" x2="${n1(px)}" y1="${y - 4}" y2="${y}" style="stroke:${theme.muted};stroke-width:1"/>`,
    );
    const label = commas(p);
    const half = label.length * 2.7;
    const anchor = px - half < LEFT - 4 ? 'start' : px + half > W - 2 ? 'end' : 'middle';
    out.push(text(px, y - 7, label, theme.muted, 9.5, `text-anchor="${anchor}"`));
  }
}

interface Chip {
  v: MapVariant;
  x1: number;
  x2: number;
  cx: number;
  chipX: number;
  chipW: number;
  lane: number;
  text: string;
}

/** バリアントの印と、重ならないよう段を分けたラベル */
function layoutChips(variants: MapVariant[], x: Scale, textOf: (v: MapVariant) => string): {
  chips: Chip[];
  lanes: number;
} {
  const chips = variants
    .map((v) => {
      const a = x(v.start);
      const b = x(v.end);
      const mid = (a + b) / 2;
      const x1 = Math.max(LEFT, Math.min(mid - 1.25, a));
      const x2 = Math.min(LEFT + CW, Math.max(mid + 1.25, b));
      const label = textOf(v);
      const chipW = label.length * 6.1 + 12;
      const cx = clampX((x1 + x2) / 2);
      const chipX = Math.min(LEFT + CW - chipW, Math.max(LEFT, cx - chipW / 2));
      return { v, x1, x2, cx, chipX, chipW, lane: 0, text: label };
    })
    .sort((p, q) => p.cx - q.cx);

  const laneEnd: number[] = [];
  for (const c of chips) {
    let lane = laneEnd.findIndex((end) => end + 4 <= c.chipX);
    if (lane < 0) {
      lane = laneEnd.length;
      laneEnd.push(0);
    }
    laneEnd[lane] = c.chipX + c.chipW;
    c.lane = lane;
  }
  return { chips, lanes: Math.max(1, laneEnd.length) };
}

function chipTitle(v: MapVariant, chrom: string): string {
  const where =
    v.end - v.start > 1
      ? `${chrom}:${commas(v.start + 1)}-${commas(v.end)}`
      : `${chrom}:${commas(v.start + 1)}`;
  return `${v.tag ? `${v.tag} ` : ''}${v.label}\n${where}`;
}

function drawChips(
  out: string[],
  chips: Chip[],
  top: number,
  barBottom: number,
  activeId: string,
  chrom: string,
): void {
  // 非選択のバリアントを先に、選択中を最後に描いて前面に出す
  const ordered = [...chips].sort(
    (a, b) => Number(a.v.id === activeId) - Number(b.v.id === activeId),
  );

  // 1. 縦帯（遺伝子の行まで届く印）
  for (const c of ordered) {
    const active = c.v.id === activeId;
    out.push(`<g data-id="${esc(c.v.id)}" style="cursor:pointer">`);
    out.push(`<title>${esc(chipTitle(c.v, chrom))}</title>`);
    out.push(
      `<rect x="${n1(c.x1)}" y="${n1(top)}" width="${n1(c.x2 - c.x1)}" height="${n1(
        Math.max(1, barBottom - top),
      )}" style="fill:${c.v.color}" opacity="${active ? 0.9 : 0.5}"/>`,
    );
    out.push('</g>');
  }

  // 2. ラベル（帯より前面。選択中を最後に描く）
  for (const c of ordered) {
    const active = c.v.id === activeId;
    const y = top + c.lane * (CHIP_H + 3);
    out.push(`<g data-id="${esc(c.v.id)}" style="cursor:pointer">`);
    out.push(`<title>${esc(chipTitle(c.v, chrom))}</title>`);
    out.push(
      `<rect x="${n1(c.chipX)}" y="${n1(y)}" width="${n1(c.chipW)}" height="${CHIP_H}" rx="3" style="fill:${c.v.color}${
        active ? ';stroke:#16191f;stroke-width:1.2' : ''
      }"/>`,
    );
    out.push(
      text(c.chipX + c.chipW / 2, y + 10.6, c.text, '#ffffff', 10, 'text-anchor="middle" font-weight="700"'),
    );
    out.push('</g>');
  }
}

/** エクソン・イントロン（転写方向の矢印つき）を 1 本の行として描く */
function drawGene(
  out: string[],
  layout: GeneLayout,
  x: Scale,
  lo: number,
  hi: number,
  cy: number,
  theme: MapTheme,
  exonLabels: boolean,
): void {
  const xs = clampX(x(Math.max(layout.txStart, lo)));
  const xe = clampX(x(Math.min(layout.txEnd, hi)));
  if (xe <= xs) return;

  const n = layout.exons.length;
  const inExon = (px: number) =>
    layout.exons.some((e) => px >= x(e.start) - 3 && px <= x(e.end) + 3);

  out.push(
    `<line x1="${n1(xs)}" x2="${n1(xe)}" y1="${cy}" y2="${cy}" style="stroke:${theme.gene};stroke-width:1"/>`,
  );
  const dir = layout.strand === '+' ? 1 : -1;
  let chevrons = '';
  for (let px = xs + 9; px < xe - 4; px += 16) {
    if (inExon(px)) continue;
    chevrons += `M${n1(px - 2 * dir)} ${cy - 3}L${n1(px + 2 * dir)} ${cy}L${n1(px - 2 * dir)} ${cy + 3}`;
  }
  if (chevrons) {
    out.push(`<path d="${chevrons}" style="fill:none;stroke:${theme.gene};stroke-width:1"/>`);
  }

  layout.exons.forEach((e, i) => {
    if (e.end <= lo || e.start >= hi) return;
    const number = layout.strand === '+' ? i + 1 : n - i;
    const parts: [number, number, number][] = [];
    if (e.start < layout.cdsStart) parts.push([e.start, Math.min(e.end, layout.cdsStart), 4]);
    const cs = Math.max(e.start, layout.cdsStart);
    const ce = Math.min(e.end, layout.cdsEnd);
    if (ce > cs) parts.push([cs, ce, 8]);
    if (e.end > layout.cdsEnd) parts.push([Math.max(e.start, layout.cdsEnd), e.end, 4]);

    out.push('<g>');
    out.push(
      `<title>${esc(`エクソン ${number}\n${formatRange(layout.chrom, e.start, e.end)}（${e.end - e.start} bp）`)}</title>`,
    );
    for (const [a, b, half] of parts) {
      const x1 = clampX(x(a));
      const x2 = clampX(x(b));
      out.push(
        `<rect x="${n1(x1)}" y="${cy - half}" width="${n1(Math.max(1.2, x2 - x1))}" height="${half * 2}" style="fill:${theme.gene}"/>`,
      );
    }
    out.push('</g>');

    if (exonLabels) {
      const w = x(e.end) - x(e.start);
      const mid = clampX((clampX(x(e.start)) + clampX(x(e.end))) / 2);
      const label = w >= 64 ? `エクソン ${number}` : w >= 12 ? String(number) : '';
      if (label) out.push(text(mid, cy + 21, label, theme.muted, 9.5, 'text-anchor="middle"'));
    }
  });
}

/** 上の段で選んだ範囲を枠で囲み、次の段へ向けて広がる帯でつなぐ */
function drawZoomLink(
  out: string[],
  x1: number,
  x2: number,
  yFrom: number,
  yTo: number,
  theme: MapTheme,
): void {
  out.push(
    `<polygon points="${n1(x1)},${yFrom} ${n1(x2)},${yFrom} ${LEFT + CW},${yTo} ${LEFT},${yTo}" style="fill:${theme.text}" opacity="0.06"/>`,
  );
  out.push(
    `<path d="M${n1(x1)} ${yFrom}L${LEFT} ${yTo}M${n1(x2)} ${yFrom}L${LEFT + CW} ${yTo}" style="fill:none;stroke:${theme.muted};stroke-width:1" stroke-dasharray="3 3"/>`,
  );
}

function trackHead(
  out: string[],
  y: number,
  title: string,
  sub: string,
  range: string,
  theme: MapTheme,
): void {
  out.push(text(8, y + 11, title, theme.text, 11.5, 'font-weight="700"'));
  if (sub) out.push(text(8, y + 25, sub, theme.muted, 9.5));
  out.push(text(LEFT + CW, y + 11, range, theme.muted, 10, 'text-anchor="end"'));
}

// ---------- 3 段の描画 ----------

function drawIdeogram(
  out: string[],
  model: MapModel,
  y: number,
  theme: MapTheme,
  focus: { lo: number; hi: number } | null,
): { height: number; boxX1: number; boxX2: number; barBottom: number } {
  const HEIGHT = 62;
  const { chromosome: chr, variants, activeId } = model;
  const x = makeScale(0, chr.length);
  const barY = y + 30;
  const barH = 20;
  const mid = barY + barH / 2;
  const r = barH / 2;
  const x0 = LEFT;
  const x1 = LEFT + CW;

  // セントロメア（acen）でくびれる輪郭。acen が無ければ角丸の棒にする
  const acen = chr.bands.filter((b) => b.stain === 'acen');
  let outline: string;
  if (acen.length >= 2) {
    const pa0 = x(acen[0].start);
    const xc = x(acen[0].end);
    const qa1 = x(acen[acen.length - 1].end);
    outline =
      `M${x0 + r} ${barY}L${n1(pa0)} ${barY}L${n1(xc)} ${mid}L${n1(qa1)} ${barY}L${x1 - r} ${barY}` +
      `A${r} ${r} 0 0 1 ${x1 - r} ${barY + barH}L${n1(qa1)} ${barY + barH}L${n1(xc)} ${mid}` +
      `L${n1(pa0)} ${barY + barH}L${x0 + r} ${barY + barH}A${r} ${r} 0 0 1 ${x0 + r} ${barY}Z`;
  } else {
    outline =
      `M${x0 + r} ${barY}L${x1 - r} ${barY}A${r} ${r} 0 0 1 ${x1 - r} ${barY + barH}` +
      `L${x0 + r} ${barY + barH}A${r} ${r} 0 0 1 ${x0 + r} ${barY}Z`;
  }

  trackHead(
    out,
    y,
    '染色体',
    chr.name,
    `${chr.name}（${formatSpan(chr.length)}）`,
    theme,
  );

  out.push(`<defs><clipPath id="chrClip"><path d="${outline}"/></clipPath></defs>`);
  out.push('<g clip-path="url(#chrClip)">');
  for (const b of chr.bands) {
    const bx = x(b.start);
    out.push(
      `<rect x="${n1(bx)}" y="${barY}" width="${n1(x(b.end) - bx + 0.4)}" height="${barH}" style="fill:${STAIN[b.stain] ?? STAIN.gneg}"><title>${esc(
        `${chr.name.replace(/^chr/, '')}${b.name}`,
      )}</title></rect>`,
    );
  }
  out.push('</g>');
  out.push(`<path d="${outline}" style="fill:none;stroke:${theme.outline};stroke-width:1"/>`);

  // 現在位置の枠（遺伝子があれば遺伝子全体、なければバリアントの範囲）
  let boxX1 = x0;
  let boxX2 = x0;
  if (focus) {
    boxX1 = x(focus.lo);
    boxX2 = Math.max(x(focus.hi), boxX1 + 4);
  }

  // 2 段目へ広がる帯がバンド名の行を横切る範囲（この中のバンド名は省く）
  const labelY = barY + barH + 9;
  const fanTop = barY + barH + 4;
  const fanBottom = y + HEIGHT + GAP - 2;
  // 文字の下端（破線が最も外へ広がっている位置）で判定する
  const t = (labelY + 5 - fanTop) / (fanBottom - fanTop);
  const fanL = boxX1 + (x0 - boxX1) * t;
  const fanR = boxX2 + (x1 - boxX2) * t;

  // バンド名（幅が足りて、前のラベル・帯と重ならないものだけ）
  let lastEnd = -Infinity;
  for (const b of chr.bands) {
    if (b.stain === 'acen') continue;
    const bx1 = x(b.start);
    const bx2 = x(b.end);
    const w = b.name.length * 5 + 4;
    const cx = (bx1 + bx2) / 2;
    const underFan = focus !== null && cx + w / 2 > fanL && cx - w / 2 < fanR;
    if (!underFan && bx2 - bx1 >= w && cx - w / 2 > lastEnd) {
      out.push(text(cx, barY + barH + 12, b.name, theme.muted, 8.5, 'text-anchor="middle"'));
      lastEnd = cx + w / 2;
    }
  }

  if (focus) {
    out.push(
      `<rect x="${n1(boxX1)}" y="${barY - 4}" width="${n1(boxX2 - boxX1)}" height="${barH + 8}" style="fill:${theme.text};stroke:${theme.text};stroke-width:1.5" fill-opacity="0.12"/>`,
    );
    const label = cytobandLabel(chr, focus.lo, focus.hi);
    const lw = label.length * 6.4;
    // 右上の染色体名と重ならない範囲に収める
    const lx = Math.min(x1 - 130, Math.max(x0 + lw / 2, (boxX1 + boxX2) / 2));
    out.push(text(lx, barY - 17, label, theme.text, 10.5, 'text-anchor="middle" font-weight="700"'));
  }

  // 染色体上のバリアント位置（▼）
  const ordered = [...variants].sort(
    (a, b) => Number(a.id === activeId) - Number(b.id === activeId),
  );
  for (const v of ordered) {
    const vx = x((v.start + v.end) / 2);
    const s = v.id === activeId ? 5.5 : 4;
    out.push(
      `<path d="M${n1(vx - s)} ${barY - 1 - s * 1.5}L${n1(vx + s)} ${barY - 1 - s * 1.5}L${n1(vx)} ${barY - 1}Z" style="fill:${v.color};stroke:#ffffff;stroke-width:0.8"/>`,
    );
  }

  return { height: HEIGHT, boxX1, boxX2, barBottom: barY + barH + 4 };
}

/** 遺伝子領域・変異の周辺で共通の描き方 */
function drawZoomTrack(
  out: string[],
  model: MapModel,
  layout: GeneLayout,
  opts: {
    y: number;
    lo: number;
    hi: number;
    title: string;
    sub: string;
    variants: MapVariant[];
    chipText: (v: MapVariant) => string;
    exonLabels: boolean;
    /** 次の段で拡大する範囲。ラベルより背面に枠で示す */
    zoomBox?: { lo: number; hi: number };
  },
  theme: MapTheme,
): { height: number; x: Scale } {
  const { y, lo, hi } = opts;
  const x = makeScale(lo, hi);
  trackHead(
    out,
    y,
    opts.title,
    opts.sub,
    `${formatRange(layout.chrom, lo, hi)}（${formatSpan(hi - lo)}）`,
    theme,
  );

  const rulerY = y + 44;
  ruler(out, x, lo, hi, rulerY, theme);

  const { chips, lanes } = layoutChips(opts.variants, x, opts.chipText);
  const chipTop = rulerY + 6;
  const chipsH = lanes * (CHIP_H + 3);
  const geneCy = chipTop + chipsH + 14;
  if (opts.zoomBox) {
    const bx1 = clampX(x(opts.zoomBox.lo));
    const bx2 = Math.max(clampX(x(opts.zoomBox.hi)), bx1 + 4);
    out.push(
      `<rect x="${n1(bx1)}" y="${rulerY + 3}" width="${n1(bx2 - bx1)}" height="${geneCy + 18 - rulerY - 3}" style="fill:${theme.text};stroke:${theme.text};stroke-width:1.5" fill-opacity="0.12"/>`,
    );
  }
  drawGene(out, layout, x, lo, hi, geneCy, theme, opts.exonLabels);
  drawChips(out, chips, chipTop, geneCy + 10, model.activeId, layout.chrom);

  const bottom = geneCy + (opts.exonLabels ? 28 : 16);
  return { height: bottom - y, x };
}

// ---------- 全体 ----------

export function renderChromosomeMap(model: MapModel, options: MapOptions): RenderedMap {
  const { theme } = options;
  const { layout, variants, activeId } = model;
  const active = variants.find((v) => v.id === activeId) ?? variants[0];

  const body: string[] = [];
  let y = options.header ? 62 : 6;

  // 1 段目の枠は、遺伝子が分かればその全体、なければバリアントの範囲
  const geneVariants = layout ? variants.filter((v) => v.accession === active.accession) : [];
  const focus = layout
    ? { lo: layout.txStart, hi: layout.txEnd }
    : {
        lo: Math.min(...variants.map((v) => v.start)),
        hi: Math.max(...variants.map((v) => v.end)),
      };

  const ideo = drawIdeogram(body, model, y, theme, focus);
  y += ideo.height;

  if (layout) {
    // ---- 2 段目: 遺伝子領域
    const span = layout.txEnd - layout.txStart;
    const pad = Math.max(span * 0.06, 500);
    const lo2 = Math.max(0, Math.floor(layout.txStart - pad));
    const hi2 = Math.min(model.chromosome.length, Math.ceil(layout.txEnd + pad));

    // 3 段目の窓: 選択中のバリアントと、その近く（CLUSTER_BP 以内）のバリアント
    const near = geneVariants.filter(
      (v) => v.start < active.end + CLUSTER_BP && v.end > active.start - CLUSTER_BP,
    );
    const vlo = Math.min(...near.map((v) => v.start));
    const vhi = Math.max(...near.map((v) => v.end));
    const half = Math.max((vhi - vlo) / 2 + Math.max((vhi - vlo) * 0.2, 60), MIN_LOCAL_BP / 2);
    const center = (vlo + vhi) / 2;
    const lo3 = Math.max(0, Math.floor(center - half));
    const hi3 = Math.ceil(center + half);

    y += GAP;
    const gene = drawZoomTrack(
      body,
      model,
      layout,
      {
        y,
        lo: lo2,
        hi: hi2,
        title: layout.gene || '遺伝子',
        sub: `${layout.accession}（${layout.strand === '+' ? '＋鎖' : '－鎖'}）`,
        variants: geneVariants,
        chipText: (v) => v.tag ?? v.label,
        exonLabels: false,
        zoomBox: { lo: lo3, hi: hi3 },
      },
      theme,
    );
    drawZoomLink(body, ideo.boxX1, ideo.boxX2, ideo.barBottom, y - 2, theme);
    const geneY = y;
    y += gene.height;

    const bx1 = clampX(gene.x(lo3));
    const bx2 = Math.max(clampX(gene.x(hi3)), bx1 + 4);
    drawZoomLink(body, bx1, bx2, geneY + gene.height, y - 2 + GAP, theme);
    y += GAP;
    const local = drawZoomTrack(
      body,
      model,
      layout,
      {
        y,
        lo: lo3,
        hi: hi3,
        title: '変異の周辺',
        sub: `${near.length > 1 ? `${near.length} 件のバリアント` : '選択中のバリアント'}`,
        variants: near,
        chipText: (v) => (v.tag ? `${v.tag} ${v.label}` : v.label),
        exonLabels: true,
      },
      theme,
    );
    y += local.height;
  }

  y += 10;

  if (options.legend) {
    const ly = y + 4;
    let lx = LEFT;
    const item = (draw: string, label: string, w: number) => {
      body.push(draw);
      body.push(text(lx + 22, ly + 9, label, theme.muted, 10));
      lx += w;
    };
    item(
      `<rect x="${lx}" y="${ly}" width="16" height="12" style="fill:${theme.gene}"/>`,
      'コード領域',
      110,
    );
    item(
      `<rect x="${lx}" y="${ly + 3}" width="16" height="6" style="fill:${theme.gene}"/>`,
      'UTR（非翻訳領域）',
      160,
    );
    item(
      `<path d="M${lx} ${ly + 6}L${lx + 16} ${ly + 6}M${lx + 6} ${ly + 2}L${lx + 10} ${ly + 6}L${lx + 6} ${ly + 10}" style="fill:none;stroke:${theme.gene};stroke-width:1"/>`,
      'イントロン（矢印は転写方向）',
      230,
    );
    item(
      `<path d="M${lx + 2} ${ly + 1}L${lx + 14} ${ly + 1}L${lx + 8} ${ly + 11}Z" style="fill:${active.color}"/>`,
      'バリアント',
      90,
    );
    y = ly + 22;
  }

  let head = '';
  if (options.header) {
    head =
      text(16, 26, options.header.title, theme.text, 17, 'font-weight="700"') +
      text(16, 46, options.header.subtitle, theme.muted, 11.5);
  }

  const height = Math.ceil(y);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" ` +
    `font-family="${FONT}" role="img" aria-label="染色体上の位置">${head}${body.join('')}</svg>`;
  return { svg, width: W, height };
}
