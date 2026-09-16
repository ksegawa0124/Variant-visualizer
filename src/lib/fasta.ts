/**
 * 比較結果を FASTA 形式で書き出す。
 * 参照配列と各バリアントの配列を同じファイルにまとめ、アラインメントツールや
 * プライマー設計ツールへそのまま渡せるようにする。
 */

import type { AnalysisRef } from './compare';
import { variantTag } from './palette';
import { CONSEQUENCE_INFO, type VariantAnalysis } from './variant';

export type FastaKind = 'protein' | 'cds' | 'transcript';

export const FASTA_KINDS: FastaKind[] = ['protein', 'cds', 'transcript'];

export const FASTA_KIND_LABEL: Record<FastaKind, string> = {
  protein: 'アミノ酸配列',
  cds: 'CDS（コード領域）',
  transcript: '転写産物の全長',
};

/** 1 行あたりの塩基・残基数（FASTA の慣例） */
const WRAP = 60;

export interface FastaOptions {
  kinds: FastaKind[];
  /** 参照配列のレコードを先頭に含める */
  includeReference: boolean;
}

export interface FastaResult {
  text: string;
  /** 書き出したレコード数 */
  count: number;
  /** 配列を書き出せなかったバリアントの説明 */
  skipped: string[];
}

/**
 * イントロン内のバリアントは転写産物配列に適用できないため、
 * 参照配列と同じ配列を「バリアント」として出すと誤解を招く。
 */
function isIntronic(a: VariantAnalysis): boolean {
  return a.consequence === 'intronic' || a.consequence === 'splice_site';
}

function refSequence(a: VariantAnalysis, kind: FastaKind): string {
  if (kind === 'protein') return a.refProtein.replace(/\*$/, '');
  if (kind === 'cds') return a.refCds;
  return a.transcript.sequence;
}

function altSequence(a: VariantAnalysis, kind: FastaKind): string {
  if (kind === 'protein') return a.altProtein.replace(/\*$/, '');
  if (kind === 'cds') return a.altCds;
  return a.altSequence;
}

function record(header: string, seq: string): string {
  const lines = [`>${header}`];
  for (let i = 0; i < seq.length; i += WRAP) lines.push(seq.slice(i, i + WRAP));
  return lines.join('\n');
}

/** 参照側のヘッダ。配列の種類ごとに識別子を変える */
function refHeader(a: VariantAnalysis, kind: FastaKind): string {
  const tx = a.transcript;
  const id =
    kind === 'protein' ? (tx.proteinId ?? `${tx.accession}_protein`) : tx.accession;
  return `ref|${id}|${kind} ${tx.gene} reference (${tx.accession})`;
}

function altHeader(ref: AnalysisRef, kind: FastaKind): string {
  const a = ref.analysis;
  const tag = variantTag(ref.order);
  const detail = kind === 'protein' ? a.hgvsP : a.parsed.normalized;
  return (
    `${tag}|${a.transcript.accession}:${a.parsed.normalized}|${kind}` +
    ` ${a.transcript.gene} ${detail} ${CONSEQUENCE_INFO[a.consequence].short}`
  );
}

/** 参照配列 + 各バリアントの配列を 1 つの FASTA にまとめる */
export function buildFasta(refs: AnalysisRef[], options: FastaOptions): FastaResult {
  const usable = refs.filter((r) => !isIntronic(r.analysis));
  const skipped = refs
    .filter((r) => isIntronic(r.analysis))
    .map(
      (r) =>
        `${variantTag(r.order)} ${r.analysis.parsed.normalized}` +
        '（イントロン内のため転写産物配列に反映できません）',
    );

  const records: string[] = [];
  for (const kind of options.kinds) {
    if (options.includeReference) {
      // 同じ参照配列を指定したバリアントが複数あっても、参照レコードは 1 つだけ出す
      const seen = new Set<string>();
      for (const r of usable) {
        const key = r.analysis.transcript.accession;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(record(refHeader(r.analysis, kind), refSequence(r.analysis, kind)));
      }
    }
    for (const r of usable) {
      records.push(record(altHeader(r, kind), altSequence(r.analysis, kind)));
    }
  }

  return {
    text: records.length > 0 ? `${records.join('\n')}\n` : '',
    count: records.length,
    skipped,
  };
}

export function fastaFileName(refs: AnalysisRef[], kinds: FastaKind[]): string {
  const tx = refs[0].analysis.transcript;
  const label =
    refs.length === 1 ? refs[0].analysis.parsed.normalized : `${refs.length}variants`;
  const base = `${tx.gene}_${tx.accession}_${label}_${kinds.join('-')}`;
  return `${base.replace(/[^A-Za-z0-9_.+-]/g, '_')}.fasta`;
}
