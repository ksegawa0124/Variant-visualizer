/**
 * CNV（コピー数変異）の入力解析と、範囲内の遺伝子の分類。
 *
 * 入力の座標は UCSC や多くのレポートと同じ 1-based・両端を含む形式で受け取り、
 * 内部では図と同じ 0-based・半開区間 [start, end) に直して扱う。
 */

import type { Assembly } from './ncbi';
import type { Chromosome, GeneLayout } from './ucsc';

export type CnvType = 'loss' | 'gain';

export const CNV_INFO: Record<CnvType, { label: string; ja: string; color: string }> = {
  loss: { label: 'Loss', ja: 'コピー数の減少（欠失）', color: '#d0342c' },
  gain: { label: 'Gain', ja: 'コピー数の増加（重複）', color: '#2563eb' },
};

export class CnvError extends Error {}

export interface CnvRegion {
  /** 例: "chr17" */
  chrom: string;
  /** 0-based・半開区間 */
  start: number;
  end: number;
  type: CnvType;
}

/** 入力欄の内容（App が保持する） */
export interface CnvFormValues {
  position: string;
  type: CnvType;
}

export interface CnvResult {
  assembly: Assembly;
  region: CnvRegion;
  chromosome: Chromosome;
  /** 図に表示する範囲（CNV の前後に余白を加えたもの） */
  window: { lo: number; hi: number };
  /** 取得に失敗したときは null */
  genes: GeneLayout[] | null;
  geneError: string | null;
}

/** CNV の範囲の前後に足す余白（CNV の長さに対する割合） */
export const WINDOW_PAD = 0.05;
/** 極端に短い CNV でも図が潰れないための、余白の下限（bp） */
const MIN_PAD_BP = 20;

const CHROMS = new Set([...Array.from({ length: 22 }, (_, i) => String(i + 1)), 'X', 'Y']);

/**
 * 「chr17:43,044,295-43,125,364」のような染色体位置を読み取る。
 * 区切りは - – — .. _ ~ 空白 などを許し、桁区切りのカンマも許す。座標は 1-based・両端を含む。
 */
export function parseCnvPosition(input: string): { chrom: string; start: number; end: number } {
  const raw = input.normalize('NFKC').trim();
  if (raw === '') throw new CnvError('染色体位置を入力してください。例: chr17:43,044,295-43,125,364');

  const m = raw.match(
    /^(?:chr)?\s*(\d{1,2}|X|Y)\s*[:\s]\s*(?:g\.)?\s*([\d,]+)\s*(?:-|–|—|―|\.\.|_|~|～|to|\s)\s*([\d,]+)$/i,
  );
  if (!m) {
    throw new CnvError(
      `「${raw}」を染色体位置として読み取れません。「chr17:43,044,295-43,125,364」の形式で入力してください。`,
    );
  }
  const name = m[1].toUpperCase();
  if (!CHROMS.has(name)) {
    throw new CnvError(`染色体 "${m[1]}" は扱えません。1〜22 番、X、Y のいずれかを指定してください。`);
  }
  const start = parseInt(m[2].replace(/,/g, ''), 10);
  const end = parseInt(m[3].replace(/,/g, ''), 10);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new CnvError('座標が大きすぎます。');
  }
  if (start < 1) throw new CnvError('開始位置は 1 以上で指定してください（座標は 1 始まりです）。');
  if (end < start) {
    throw new CnvError(
      `終了位置（${end.toLocaleString('en-US')}）が開始位置（${start.toLocaleString('en-US')}）より小さくなっています。`,
    );
  }
  return { chrom: `chr${name}`, start, end };
}

/** 入力した範囲が、選んだリファレンスゲノムの染色体に収まっているか確認する */
export function assertWithinChromosome(
  end: number,
  chromosome: Chromosome,
  assemblyLabel: string,
): void {
  if (end > chromosome.length) {
    throw new CnvError(
      `終了位置が ${chromosome.name} の長さ（${chromosome.length.toLocaleString('en-US')} bp、${assemblyLabel}）を超えています。` +
        '座標とリファレンスゲノム（GRCh38 / GRCh37）の組み合わせを確認してください。',
    );
  }
}

/** 図に表示する範囲: CNV の前後に 5% ずつ余白を加える（染色体の端を超えない） */
export function cnvWindow(
  region: Pick<CnvRegion, 'start' | 'end'>,
  chromosomeLength: number,
): { lo: number; hi: number } {
  const pad = Math.max(Math.round((region.end - region.start) * WINDOW_PAD), MIN_PAD_BP);
  return {
    lo: Math.max(0, region.start - pad),
    hi: Math.min(chromosomeLength, region.end + pad),
  };
}

// ---------- 遺伝子の分類 ----------

/**
 * CNV と遺伝子の位置関係
 *   contained … 遺伝子全体が範囲内
 *   left      … 開始側のブレークポイントが遺伝子内にある（遺伝子の右部分が範囲内）
 *   right     … 終了側のブレークポイントが遺伝子内にある（遺伝子の左部分が範囲内）
 *   spans     … CNV が遺伝子の内側に収まっている（両端のブレークポイントが遺伝子内）
 *   outside   … 範囲外
 */
export type GeneRelation = 'contained' | 'left' | 'right' | 'spans' | 'outside';

export const RELATION_LABEL: Record<GeneRelation, string> = {
  contained: '全体が範囲内',
  left: '開始側のブレークポイントで切断',
  right: '終了側のブレークポイントで切断',
  spans: 'CNV が遺伝子内に収まる',
  outside: '範囲外',
};

export interface GeneHit {
  gene: GeneLayout;
  relation: GeneRelation;
  /** CNV と重なる長さ（bp） */
  overlap: number;
  /** タンパク質をコードする転写産物か（NM_ など。ncRNA は false） */
  coding: boolean;
  /** CNV と重なるエクソン番号の範囲（転写方向の番号）。重ならなければ null */
  exons: { first: number; last: number; count: number; total: number } | null;
}

export function classifyGene(gene: GeneLayout, region: Pick<CnvRegion, 'start' | 'end'>): GeneHit {
  const { start: s, end: e } = region;
  const { txStart: ts, txEnd: te } = gene;

  let relation: GeneRelation;
  if (te <= s || ts >= e) relation = 'outside';
  else if (ts >= s && te <= e) relation = 'contained';
  else if (ts < s && te > e) relation = 'spans';
  else if (ts < s) relation = 'left';
  else relation = 'right';

  const total = gene.exons.length;
  const hit: number[] = [];
  gene.exons.forEach((x, i) => {
    if (x.end > s && x.start < e) hit.push(gene.strand === '+' ? i + 1 : total - i);
  });
  return {
    gene,
    relation,
    overlap: Math.max(0, Math.min(te, e) - Math.max(ts, s)),
    coding: gene.cdsEnd > gene.cdsStart,
    exons:
      hit.length > 0
        ? { first: Math.min(...hit), last: Math.max(...hit), count: hit.length, total }
        : null,
  };
}

export function classifyGenes(
  genes: GeneLayout[],
  region: Pick<CnvRegion, 'start' | 'end'>,
): GeneHit[] {
  return genes.map((g) => classifyGene(g, region));
}

export function exonText(h: GeneHit): string {
  if (!h.exons) return '—';
  const { first, last, count, total } = h.exons;
  const range = first === last ? `${first}` : `${first}–${last}`;
  return count === total ? `全 ${total} エクソン` : `エクソン ${range}（${count}/${total}）`;
}

/** 範囲に含まれる遺伝子の一覧をタブ区切りテキストにする（表計算ソフトに貼り付けられる） */
export function genesToTsv(hits: GeneHit[]): string {
  const header = [
    '遺伝子',
    '参照配列',
    '染色体',
    '開始(1-based)',
    '終了',
    '鎖',
    '種類',
    'CNVとの関係',
    '重なり(bp)',
    '重なるエクソン',
  ];
  const rows = hits
    .filter((h) => h.relation !== 'outside')
    .map((h) =>
      [
        h.gene.gene,
        h.gene.accession,
        h.gene.chrom,
        h.gene.txStart + 1,
        h.gene.txEnd,
        h.gene.strand,
        h.coding ? 'タンパク質コード' : '非コード',
        RELATION_LABEL[h.relation],
        h.overlap,
        exonText(h),
      ].join('\t'),
    );
  return [header.join('\t'), ...rows].join('\n') + '\n';
}
