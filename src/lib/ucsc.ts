/**
 * UCSC Genome Browser の REST API から、染色体の図示に必要なデータを取得する。
 *   - cytoBandIdeo : 染色体のバンド（イディオグラム）
 *   - ncbiRefSeq*  : RefSeq 転写産物のエクソン構造（ゲノム座標）
 * いずれも CORS が許可されており、ブラウザから直接呼べる。
 *
 * 座標はすべて UCSC の 0-based・半開区間 [start, end) のまま扱う。
 */

import type { Assembly } from './ncbi';

const API = 'https://api.genome.ucsc.edu/getData/track';
const TIMEOUT_MS = 25_000;

export const UCSC_DB: Record<Assembly, string> = { GRCh38: 'hg38', GRCh37: 'hg19' };

export class UcscError extends Error {}

export interface Cytoband {
  start: number;
  end: number;
  /** 例: "q21.31" */
  name: string;
  /** gneg / gpos25 / gpos50 / gpos75 / gpos100 / gvar / stalk / acen */
  stain: string;
}

export interface Chromosome {
  /** 例: "chr17" */
  name: string;
  length: number;
  bands: Cytoband[];
}

export interface GeneLayout {
  accession: string;
  gene: string;
  chrom: string;
  strand: '+' | '-';
  txStart: number;
  txEnd: number;
  cdsStart: number;
  cdsEnd: number;
  /** ゲノム上の昇順。転写方向に依らずエクソン番号は strand から求める */
  exons: { start: number; end: number }[];
}

async function getTrack<T>(query: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}?${query}`, { signal: ctrl.signal });
    if (!res.ok) throw new UcscError(`UCSC Genome Browser が HTTP ${res.status} を返しました。`);
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof UcscError) throw e;
    throw new UcscError('UCSC Genome Browser に接続できませんでした。');
  } finally {
    clearTimeout(timer);
  }
}

/** 同じ問い合わせを繰り返さない。失敗は再試行できるよう記憶しない */
function cached<K extends string, V>(store: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  const hit = store.get(key);
  if (hit) return hit;
  const p = load();
  store.set(key, p);
  p.catch(() => store.delete(key));
  return p;
}

const chromosomes = new Map<string, Promise<Chromosome>>();

export function fetchChromosome(assembly: Assembly, chrom: string): Promise<Chromosome> {
  const db = UCSC_DB[assembly];
  return cached(chromosomes, `${db}:${chrom}`, async () => {
    const data = await getTrack<{
      cytoBandIdeo?: { chromStart: number; chromEnd: number; name: string; gieStain: string }[];
    }>(`genome=${db};track=cytoBandIdeo;chrom=${chrom}`);
    const bands = (data.cytoBandIdeo ?? []).map((b) => ({
      start: b.chromStart,
      end: b.chromEnd,
      name: b.name,
      stain: b.gieStain,
    }));
    if (bands.length === 0) throw new UcscError(`${chrom} のバンド情報が見つかりません。`);
    bands.sort((a, b) => a.start - b.start);
    return { name: chrom, length: bands[bands.length - 1].end, bands };
  });
}

interface RefSeqRow {
  name: string;
  name2?: string;
  chrom: string;
  strand: string;
  txStart: number;
  txEnd: number;
  cdsStart: number;
  cdsEnd: number;
  exonStarts: string;
  exonEnds: string;
}

function numbers(csv: string): number[] {
  return csv
    .split(',')
    .filter((v) => v !== '')
    .map((v) => parseInt(v, 10));
}

function toLayout(r: RefSeqRow): GeneLayout {
  const starts = numbers(r.exonStarts);
  const ends = numbers(r.exonEnds);
  return {
    accession: r.name,
    gene: r.name2 ?? '',
    chrom: r.chrom,
    strand: r.strand === '-' ? '-' : '+',
    txStart: r.txStart,
    txEnd: r.txEnd,
    cdsStart: r.cdsStart,
    cdsEnd: r.cdsEnd,
    exons: starts.map((s, i) => ({ start: s, end: ends[i] })),
  };
}

const baseName = (accession: string) => accession.split('.')[0];

/** 版が異なる場合（UCSC が別の版を載せている場合）は、同じ版を優先しつつ版違いも拾う */
function pick(rows: RefSeqRow[], accession: string): RefSeqRow | undefined {
  return (
    rows.find((r) => r.name === accession) ??
    rows.find((r) => baseName(r.name) === baseName(accession))
  );
}

const layouts = new Map<string, Promise<GeneLayout | null>>();

/**
 * 参照配列のエクソン構造を取得する。
 * 変異位置を含む狭い範囲だけを問い合わせる。まず小さな Select トラック
 * （MANE などの代表転写産物のみ）を試し、無ければ全 RefSeq トラックを探す。
 */
export function fetchGeneLayout(
  assembly: Assembly,
  chrom: string,
  position: number,
  accession: string,
): Promise<GeneLayout | null> {
  const db = UCSC_DB[assembly];
  return cached(layouts, `${db}:${accession}`, async () => {
    const start = Math.max(0, position - 1);
    const range = `chrom=${chrom};start=${start};end=${position + 1}`;
    for (const track of ['ncbiRefSeqSelect', 'ncbiRefSeq']) {
      const data = await getTrack<Record<string, RefSeqRow[] | undefined>>(
        `genome=${db};track=${track};${range}`,
      );
      const hit = pick(data[track] ?? [], accession);
      if (hit) return toLayout(hit);
    }
    return null;
  });
}

/** UCSC Genome Browser で同じ領域を開く URL */
export function ucscBrowserUrl(
  assembly: Assembly,
  chrom: string,
  start: number,
  end: number,
): string {
  return `https://genome.ucsc.edu/cgi-bin/hgTracks?db=${UCSC_DB[assembly]}&position=${chrom}:${start}-${end}`;
}
