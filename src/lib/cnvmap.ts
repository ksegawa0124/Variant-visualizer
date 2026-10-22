/**
 * CNV の位置と、その周辺の遺伝子を描く SVG を組み立てる。
 *
 *   1. 染色体 … バンド付きのイディオグラム。CNV の範囲に色を重ねる
 *   2. CNV 周辺 … CNV の前後に 5% ずつ余白を加えた範囲を拡大し、
 *                 CNV の範囲を帯で強調して、重なる遺伝子を並べる
 *
 * 画面（CSS 変数でテーマに追従）と PNG 書き出し（固定の配色）の両方が
 * 同じ関数を通る。座標は 0-based・半開区間 [start, end)。
 */

import {
  clampX,
  commas,
  CW,
  drawIdeogram,
  drawZoomLink,
  esc,
  FONT,
  formatRange,
  formatSpan,
  GAP,
  LEFT,
  makeScale,
  n1,
  ruler,
  text,
  trackHead,
  W,
  type MapModel,
  type MapOptions,
  type MapTheme,
  type RenderedMap,
  type Scale,
} from './chrommap';
import { CNV_INFO, exonText, RELATION_LABEL, type CnvRegion, type GeneHit } from './cnv';
import type { Chromosome } from './ucsc';

export interface CnvMapModel {
  chromosome: Chromosome;
  region: CnvRegion;
  window: { lo: number; hi: number };
  /** 表示範囲と重なる遺伝子（範囲外のものも含む） */
  hits: GeneHit[];
  /** 遺伝子の取得に失敗した（「遺伝子なし」と区別して案内する） */
  genesFailed?: boolean;
}

/** ラベル付きで並べる段数の上限。超えた遺伝子はラベルなしで詰める */
const MAX_LABEL_LANES = 10;
/** ラベルなしも含めた段数の上限。超えた遺伝子は省略する */
const MAX_LANES = 36;
const LANE_H_LABEL = 30;
const LANE_H_PLAIN = 16;

interface Placed {
  hit: GeneHit;
  x1: number;
  x2: number;
  lane: number;
  label: { x: number; w: number } | null;
}

const labelWidth = (name: string) => name.length * 5.7 + 4;

/** 遺伝子を段に振り分ける。CNV に関わる遺伝子を優先してラベルを付ける */
function packGenes(
  hits: GeneHit[],
  x: Scale,
  lo: number,
  hi: number,
): { placed: Placed[]; laneCount: number; hasLabel: boolean[]; omitted: number } {
  const visible = hits.filter((h) => h.gene.txEnd > lo && h.gene.txStart < hi);
  const ordered = [...visible].sort(
    (a, b) =>
      Number(a.relation === 'outside') - Number(b.relation === 'outside') ||
      a.gene.txStart - b.gene.txStart,
  );

  const lanes: [number, number][][] = [];
  const hasLabel: boolean[] = [];
  const fits = (k: number, a: number, b: number) =>
    !lanes[k] || lanes[k].every(([p, q]) => b + 2 <= p || a >= q + 2);
  const take = (k: number, a: number, b: number, labelled: boolean) => {
    (lanes[k] ??= []).push([a, b]);
    hasLabel[k] = hasLabel[k] || labelled;
  };

  const placed: Placed[] = [];
  let omitted = 0;
  for (const hit of ordered) {
    const g = hit.gene;
    let x1 = clampX(x(Math.max(g.txStart, lo)));
    let x2 = clampX(x(Math.min(g.txEnd, hi)));
    if (x2 - x1 < 3) {
      x2 = Math.min(LEFT + CW, x1 + 3);
      x1 = x2 - 3;
    }
    const lw = labelWidth(g.gene || g.accession);
    const lx = Math.min(LEFT + CW - lw / 2, Math.max(LEFT + lw / 2, (x1 + x2) / 2));
    // ラベルの左右に余白を持たせ、隣の遺伝子名とくっつかないようにする
    const fa = Math.min(x1, lx - lw / 2 - 3);
    const fb = Math.max(x2, lx + lw / 2 + 3);

    let lane = -1;
    let label: Placed['label'] = null;
    for (let k = 0; k < MAX_LABEL_LANES && lane < 0; k += 1) {
      if (fits(k, fa, fb)) {
        lane = k;
        label = { x: lx, w: lw };
        take(k, fa, fb, true);
      }
    }
    for (let k = 0; k < MAX_LANES && lane < 0; k += 1) {
      if (fits(k, x1, x2)) {
        lane = k;
        take(k, x1, x2, false);
      }
    }
    if (lane < 0) {
      omitted += 1;
      continue;
    }
    placed.push({ hit, x1, x2, lane, label });
  }
  return { placed, laneCount: Math.max(1, lanes.length), hasLabel, omitted };
}

function geneColor(h: GeneHit, region: CnvRegion, theme: MapTheme): string {
  if (h.relation === 'outside') return theme.muted;
  if (h.relation === 'contained') return theme.gene;
  return CNV_INFO[region.type].color;
}

function geneTitle(h: GeneHit): string {
  const g = h.gene;
  const lines = [
    `${g.gene || g.accession}（${g.accession}、${g.strand === '+' ? '＋鎖' : '－鎖'}）`,
    `${formatRange(g.chrom, g.txStart, g.txEnd)}（${formatSpan(g.txEnd - g.txStart)}）`,
    `CNV との関係: ${RELATION_LABEL[h.relation]}`,
  ];
  if (h.exons) lines.push(`CNV と重なるエクソン: ${exonText(h)}`);
  return lines.join('\n');
}

/** 遺伝子 1 本（エクソン・イントロン・転写方向の矢印）を描く */
function drawGeneGlyph(
  out: string[],
  p: Placed,
  cy: number,
  color: string,
  x: Scale,
  lo: number,
  hi: number,
): void {
  const g = p.hit.gene;
  const w = p.x2 - p.x1;
  out.push('<g>');
  out.push(`<title>${esc(geneTitle(p.hit))}</title>`);

  if (w < 24) {
    out.push(
      `<rect x="${n1(p.x1)}" y="${cy - 5}" width="${n1(w)}" height="10" style="fill:${color}"/>`,
    );
  } else {
    out.push(
      `<line x1="${n1(p.x1)}" x2="${n1(p.x2)}" y1="${cy}" y2="${cy}" style="stroke:${color};stroke-width:1"/>`,
    );
    const dir = g.strand === '+' ? 1 : -1;
    let chevrons = '';
    for (let px = p.x1 + 8; px < p.x2 - 4; px += 14) {
      chevrons += `M${n1(px - 2 * dir)} ${cy - 3}L${n1(px + 2 * dir)} ${cy}L${n1(px - 2 * dir)} ${cy + 3}`;
    }
    if (chevrons) {
      out.push(`<path d="${chevrons}" style="fill:none;stroke:${color};stroke-width:1"/>`);
    }
    for (const e of g.exons) {
      if (e.end <= lo || e.start >= hi) continue;
      const parts: [number, number, number][] = [];
      if (e.start < g.cdsStart) parts.push([e.start, Math.min(e.end, g.cdsStart), 3]);
      const cs = Math.max(e.start, g.cdsStart);
      const ce = Math.min(e.end, g.cdsEnd);
      if (ce > cs) parts.push([cs, ce, 6]);
      if (e.end > g.cdsEnd) parts.push([Math.max(e.start, g.cdsEnd), e.end, 3]);
      for (const [a, b, half] of parts) {
        const xa = clampX(x(a));
        const xb = clampX(x(b));
        out.push(
          `<rect x="${n1(xa)}" y="${cy - half}" width="${n1(Math.max(1, xb - xa))}" height="${half * 2}" style="fill:${color}"/>`,
        );
      }
    }
  }
  out.push('</g>');
}

export function renderCnvMap(model: CnvMapModel, options: MapOptions): RenderedMap {
  const { theme } = options;
  const { chromosome, region, window: win, hits, genesFailed } = model;
  const info = CNV_INFO[region.type];
  const len = region.end - region.start;

  const body: string[] = [];
  let y = options.header ? 62 : 6;

  // ---- 1 段目: 染色体。CNV の範囲に色を重ね、▼ で位置を示す
  const ideoModel: MapModel = {
    chromosome,
    layout: null,
    activeId: 'cnv',
    variants: [
      {
        id: 'cnv',
        order: 0,
        tag: null,
        label: info.label,
        color: info.color,
        accession: '',
        start: region.start,
        end: region.end,
      },
    ],
  };
  const ideo = drawIdeogram(body, ideoModel, y, theme, { lo: region.start, hi: region.end }, {
    lo: region.start,
    hi: region.end,
    color: info.color,
  });
  y += ideo.height + GAP;

  // ---- 2 段目: CNV 周辺
  const top = y;
  const x = makeScale(win.lo, win.hi);
  trackHead(
    body,
    top,
    'CNV 周辺',
    '範囲の前後 5% を含む',
    `${formatRange(region.chrom, win.lo, win.hi)}（${formatSpan(win.hi - win.lo)}）`,
    theme,
  );
  drawZoomLink(body, ideo.boxX1, ideo.boxX2, ideo.barBottom, top - 2, theme);

  const rulerY = top + 44;
  const cx1 = clampX(x(region.start));
  const cx2 = Math.max(clampX(x(region.end)), cx1 + 3);

  // CNV の帯（遺伝子の背面に敷くので、高さが決まってから挿入する）
  const barY = rulerY + 10;
  const barH = 16;
  const coordY = barY + barH + 11;
  const genesTop = coordY + 12;

  const pack = packGenes(hits, x, win.lo, win.hi);
  const laneTop: number[] = [];
  let cursor = genesTop;
  for (let k = 0; k < pack.laneCount; k += 1) {
    laneTop.push(cursor);
    cursor += pack.hasLabel[k] ? LANE_H_LABEL : LANE_H_PLAIN;
  }
  let bottom = cursor + 4;
  if (pack.omitted > 0) bottom += 14;

  ruler(body, x, win.lo, win.hi, rulerY, theme);

  // 範囲の強調（ルーラーから最下段まで）。左右の縁は破線で示す
  body.push(
    `<rect x="${n1(cx1)}" y="${rulerY + 3}" width="${n1(cx2 - cx1)}" height="${n1(bottom - rulerY - 3)}" style="fill:${info.color}" fill-opacity="0.12"/>`,
  );
  body.push(
    `<path d="M${n1(cx1)} ${rulerY + 3}V${n1(bottom)}M${n1(cx2)} ${rulerY + 3}V${n1(bottom)}" style="fill:none;stroke:${info.color};stroke-width:1.2" stroke-dasharray="4 3"/>`,
  );

  // CNV の棒と、種類・サイズ
  body.push('<g>');
  body.push(
    `<title>${esc(`${info.label}（${info.ja}）\n${formatRange(region.chrom, region.start, region.end)}（${formatSpan(len)}）`)}</title>`,
  );
  body.push(
    `<rect x="${n1(cx1)}" y="${barY}" width="${n1(cx2 - cx1)}" height="${barH}" rx="2" style="fill:${info.color}"/>`,
  );
  body.push('</g>');
  const barText = `${info.label}　${formatSpan(len)}`;
  const barTextW = barText.length * 6.4 + 12;
  if (cx2 - cx1 >= barTextW) {
    body.push(
      text((cx1 + cx2) / 2, barY + 11.5, barText, '#ffffff', 11, 'text-anchor="middle" font-weight="700"'),
    );
  } else if (cx2 + 8 + barTextW <= LEFT + CW) {
    body.push(text(cx2 + 6, barY + 11.5, barText, info.color, 11, 'font-weight="700"'));
  } else {
    body.push(text(cx1 - 6, barY + 11.5, barText, info.color, 11, 'text-anchor="end" font-weight="700"'));
  }

  // ブレークポイントの座標（幅が足りれば両端に、狭ければ中央に範囲をまとめて）
  if (cx2 - cx1 >= 230) {
    body.push(text(cx1, coordY, commas(region.start + 1), theme.text, 9.5, 'font-weight="700"'));
    body.push(
      text(cx2, coordY, commas(region.end), theme.text, 9.5, 'text-anchor="end" font-weight="700"'),
    );
  } else {
    const label = formatRange(region.chrom, region.start, region.end);
    const lw = label.length * 5.4;
    const lx = Math.min(LEFT + CW - lw / 2, Math.max(LEFT + lw / 2, (cx1 + cx2) / 2));
    body.push(text(lx, coordY, label, theme.text, 9.5, 'text-anchor="middle" font-weight="700"'));
  }

  // 遺伝子
  for (const p of pack.placed) {
    const cy = laneTop[p.lane] + 8;
    const color = geneColor(p.hit, region, theme);
    drawGeneGlyph(body, p, cy, color, x, win.lo, win.hi);
    if (p.label) {
      const name = p.hit.gene.gene || p.hit.gene.accession;
      const weight = p.hit.relation === 'outside' ? '' : ' font-weight="700"';
      body.push(
        text(p.label.x, cy + 18, name, p.hit.relation === 'outside' ? theme.muted : theme.text, 10, `text-anchor="middle"${weight}`),
      );
    }
  }
  if (pack.placed.length === 0) {
    body.push(
      text(
        LEFT + CW / 2,
        genesTop + 12,
        genesFailed ? '遺伝子の情報を取得できませんでした' : '表示範囲に遺伝子（RefSeq Select）はありません',
        theme.muted,
        10.5,
        'text-anchor="middle"',
      ),
    );
  }
  if (pack.omitted > 0) {
    body.push(
      text(LEFT, bottom - 2, `ほか ${pack.omitted} 遺伝子は混み合うため図では省略しています（一覧を参照）`, theme.muted, 9.5),
    );
  }
  y = bottom + 10;

  if (options.legend) {
    const ly = y + 4;
    let lx = LEFT;
    const item = (draw: string, label: string, w: number) => {
      body.push(draw);
      body.push(text(lx + 22, ly + 9, label, theme.muted, 10));
      lx += w;
    };
    item(
      `<rect x="${lx}" y="${ly}" width="16" height="12" rx="2" style="fill:${info.color}"/>`,
      `CNV（${info.label}）`,
      124,
    );
    item(
      `<rect x="${lx}" y="${ly + 2}" width="16" height="8" style="fill:${theme.gene}"/>`,
      '範囲内の遺伝子',
      126,
    );
    item(
      `<rect x="${lx}" y="${ly + 2}" width="16" height="8" style="fill:${info.color}"/>`,
      'ブレークポイントで切断される遺伝子',
      236,
    );
    item(
      `<rect x="${lx}" y="${ly + 2}" width="16" height="8" style="fill:${theme.muted}"/>`,
      '範囲外の遺伝子',
      110,
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
    `font-family="${FONT}" role="img" aria-label="CNV の位置と周辺の遺伝子">${head}${body.join('')}</svg>`;
  return { svg, width: W, height };
}
