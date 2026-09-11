/**
 * 複数バリアントの比較表に使うデータ。
 * 画面の表・PNG 出力・TSV コピーが同じ行データを共有する。
 */

import { variantColor, variantTag } from './palette';
import type { GenomicMapping } from './ncbi';
import { CONSEQUENCE_INFO, type VariantAnalysis } from './variant';

/** 入力 1 件分の解析結果（失敗した場合も行として残す） */
export interface EntryResult {
  id: string;
  /** 入力順。色とタグ (V1, V2…) の割り当てに使う */
  index: number;
  input: { gene: string; variant: string; accession: string };
  analysis: VariantAnalysis | null;
  error: string | null;
  warnings: string[];
  genomic: GenomicMapping | null;
  genomicPending: boolean;
}

/** 解析に成功した入力（表示順を保った参照） */
export interface AnalysisRef {
  id: string;
  /** 入力順。色とタグ (V1, V2…) の割り当てに使う */
  order: number;
  analysis: VariantAnalysis;
}

export interface ComparisonRow {
  id: string;
  tag: string;
  color: string;
  gene: string;
  accession: string;
  hgvsC: string;
  consequence: string;
  severity: 'high' | 'moderate' | 'low' | 'unknown';
  hgvsP: string;
  location: string;
  protein: string;
  /** 取得済みのゲノム座標。未取得・取得失敗なら '—' */
  genomic: string;
  /** ゲノム座標を問い合わせ中（画面では「照会中…」と出す） */
  genomicPending: boolean;
  error: string | null;
}

function proteinText(a: VariantAnalysis): string {
  const ref = a.refProtein.replace(/\*$/, '').length;
  if (!a.proteinComputed) return `${ref} aa（算出不可）`;
  const alt = a.altProtein.replace(/\*$/, '').length;
  if (alt === ref) return `${ref} aa（変化なし）`;
  const delta = alt - ref;
  return `${ref} → ${alt} aa（${delta > 0 ? '+' : ''}${delta}）`;
}

function locationText(a: VariantAnalysis): string {
  const parts: string[] = [];
  if (a.exonNumber) parts.push(`エクソン ${a.exonNumber}`);
  if (a.codonNumber) parts.push(`コドン ${a.codonNumber}`);
  return parts.length > 0 ? parts.join(' / ') : '—';
}

export function buildComparisonRows(entries: EntryResult[]): ComparisonRow[] {
  return entries.map((e) => {
    const base = {
      id: e.id,
      tag: variantTag(e.index),
      color: variantColor(e.index),
      genomic: e.genomic ? e.genomic.hgvsG : '—',
      genomicPending: e.genomicPending,
    };
    if (!e.analysis) {
      return {
        ...base,
        gene: e.input.gene || '—',
        accession: e.input.accession || '—',
        hgvsC: e.input.variant || '—',
        consequence: '解析できません',
        severity: 'unknown' as const,
        hgvsP: '—',
        location: '—',
        protein: '—',
        genomic: '—',
        genomicPending: false,
        error: e.error,
      };
    }
    const a = e.analysis;
    const info = CONSEQUENCE_INFO[a.consequence];
    return {
      ...base,
      gene: a.transcript.gene,
      accession: a.transcript.accession,
      hgvsC: a.parsed.normalized,
      consequence: info.label,
      severity: info.severity,
      hgvsP: a.hgvsP,
      location: locationText(a),
      protein: proteinText(a),
      error: null,
    };
  });
}

const TSV_HEADER = [
  'タグ',
  '遺伝子',
  '参照配列',
  'HGVS.c',
  '変異型',
  'HGVS.p',
  '位置',
  'タンパク質長',
  'ゲノム座標',
];

/** 表計算ソフトへそのまま貼れる TSV にする */
export function comparisonTsv(rows: ComparisonRow[]): string {
  const body = rows.map((r) =>
    [
      r.tag,
      r.gene,
      r.accession,
      r.hgvsC,
      r.error ? `解析できません: ${r.error}` : r.consequence,
      r.hgvsP,
      r.location,
      r.protein,
      r.genomic,
    ].join('\t'),
  );
  return [TSV_HEADER.join('\t'), ...body].join('\n');
}

/** 解析に成功した入力だけを、入力順を保ったまま取り出す */
export function analysisRefs(entries: EntryResult[]): AnalysisRef[] {
  return entries.flatMap((e) =>
    e.analysis ? [{ id: e.id, order: e.index, analysis: e.analysis }] : [],
  );
}

/** 同じ参照配列に対するバリアントだけが 1 つの図に重ねられる */
export function sameTranscript(refs: AnalysisRef[]): boolean {
  if (refs.length <= 1) return true;
  const first = refs[0].analysis.transcript.accession;
  return refs.every((r) => r.analysis.transcript.accession === first);
}
