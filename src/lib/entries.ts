/** 入力フォームの状態（比較したいバリアントの一覧） */

import type { Assembly } from './ncbi';

export interface VariantEntry {
  /** React のキーと解析結果の突き合わせに使う安定した ID */
  id: string;
  accession: string;
  gene: string;
  variant: string;
}

export interface FormValues {
  /** リファレンスゲノムは全バリアントで共通（ゲノム座標の表示にのみ影響する） */
  assembly: Assembly;
  entries: VariantEntry[];
}

let nextId = 0;

export function newEntry(init: Partial<VariantEntry> = {}): VariantEntry {
  nextId += 1;
  return { id: `v${nextId}`, accession: '', gene: '', variant: '', ...init };
}

/** 一度に比較できるバリアント数の上限（NCBI への連続問い合わせを抑えるため） */
export const MAX_ENTRIES = 8;
