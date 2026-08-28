/** 参照配列にバリアントを適用し、DNA / アミノ酸レベルの変化を求める */

import { aa3, translate, reverseComplement } from './codon';
import type { TranscriptRecord } from './genbank';
import { formatPosition, type CPosition, type ParsedVariant } from './hgvs';

export type Consequence =
  | 'no_change'
  | 'synonymous'
  | 'missense'
  | 'nonsense'
  | 'frameshift'
  | 'inframe_deletion'
  | 'inframe_insertion'
  | 'inframe_duplication'
  | 'inframe_delins'
  | 'start_loss'
  | 'stop_loss'
  | 'utr5'
  | 'utr3'
  | 'splice_site'
  | 'intronic';

export interface ConsequenceStyle {
  label: string;
  short: string;
  severity: 'high' | 'moderate' | 'low' | 'unknown';
}

export const CONSEQUENCE_INFO: Record<Consequence, ConsequenceStyle> = {
  no_change: { label: '変化なし', short: 'no change', severity: 'low' },
  synonymous: { label: '同義置換 (silent)', short: 'synonymous', severity: 'low' },
  missense: { label: 'ミスセンス変異', short: 'missense', severity: 'moderate' },
  nonsense: { label: 'ナンセンス変異（終止コドン獲得）', short: 'nonsense', severity: 'high' },
  frameshift: { label: 'フレームシフト変異', short: 'frameshift', severity: 'high' },
  inframe_deletion: { label: 'インフレーム欠失', short: 'inframe deletion', severity: 'moderate' },
  inframe_insertion: { label: 'インフレーム挿入', short: 'inframe insertion', severity: 'moderate' },
  inframe_duplication: { label: 'インフレーム重複', short: 'inframe duplication', severity: 'moderate' },
  inframe_delins: { label: 'インフレーム欠失挿入', short: 'inframe delins', severity: 'moderate' },
  start_loss: { label: '開始コドンの消失', short: 'start lost', severity: 'high' },
  stop_loss: { label: '終止コドンの消失（読み過ごし）', short: 'stop lost', severity: 'high' },
  utr5: { label: '5′UTR バリアント', short: "5'UTR", severity: 'unknown' },
  utr3: { label: '3′UTR バリアント', short: "3'UTR", severity: 'unknown' },
  splice_site: { label: 'スプライス部位バリアント', short: 'splice site', severity: 'high' },
  intronic: { label: 'イントロン内バリアント', short: 'intronic', severity: 'unknown' },
};

export interface VariantAnalysis {
  transcript: TranscriptRecord;
  parsed: ParsedVariant;
  /** 表示用の完全な HGVS.c 記載 */
  hgvsC: string;
  /** 転写産物上の 0-based 変更開始位置 */
  changeIndex: number;
  refBases: string;
  altBases: string;
  /** 変異後の転写産物全長配列 */
  altSequence: string;
  /** 変異後の CDS 開始位置（1-based, altSequence 上） */
  altCdsStart: number;
  refCds: string;
  altCds: string;
  /** 参照タンパク質（終止コドンを * として含む） */
  refProtein: string;
  /** 変異タンパク質（終止コドンに達した場合は末尾が *） */
  altProtein: string;
  altHasStop: boolean;
  consequence: Consequence;
  hgvsP: string;
  /** 最初にアミノ酸が変化する位置（1-based）。影響がない場合は null */
  proteinChangeStart: number | null;
  /** タンパク質配列を算出できたか（イントロン変異などでは false） */
  proteinComputed: boolean;
  /** 変異が影響する最初のコドン番号（1-based, CDS 内のとき） */
  codonNumber: number | null;
  exonNumber: number | null;
  description: string;
  notes: string[];
}

export class VariantError extends Error {}

/** c. 座標 → 転写産物上の 0-based インデックス（エクソン内の位置のみ） */
export function cPositionToIndex(pos: CPosition, tx: TranscriptRecord): number {
  if (pos.offset !== 0) {
    throw new VariantError('イントロン位置は転写産物配列に対応付けられません。');
  }
  let index: number;
  if (pos.region === 'cds') index = tx.cdsStart - 1 + (pos.base - 1);
  else if (pos.region === 'utr5') index = tx.cdsStart - 1 + pos.base;
  else index = tx.cdsEnd + pos.base - 1;

  if (index < 0 || index >= tx.sequence.length) {
    const cdsLen = tx.cdsEnd - tx.cdsStart + 1;
    throw new VariantError(
      `位置 c.${formatPosition(pos)} は参照配列 ${tx.accession} の範囲外です` +
        `（全長 ${tx.sequence.length} bp / CDS は c.1〜c.${cdsLen}）。`,
    );
  }
  return index;
}

function exonNumberAt(index1: number, tx: TranscriptRecord): number | null {
  const i = tx.exons.findIndex((e) => index1 >= e.start && index1 <= e.end);
  if (i < 0) return null;
  const numbered = tx.exons[i].number;
  const parsed = numbered ? parseInt(numbered, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : i + 1;
}

/** 欠失・重複を HGVS の 3′ ルールに従って最も 3′ 側へ寄せる */
function shift3prime(seq: string, start: number, length: number): number {
  let s = start;
  while (s + length < seq.length && seq[s] === seq[s + length]) s += 1;
  return s;
}

interface ProteinChange {
  consequence: Consequence;
  hgvsP: string;
  position: number | null;
}

function terLabel(altProtein: string, from: number, hasStop: boolean): string {
  if (!hasStop) return 'Ter?';
  const stopIdx = altProtein.indexOf('*', from);
  if (stopIdx < 0) return 'Ter?';
  return `Ter${stopIdx - from + 1}`;
}

function aa3str(seq: string): string {
  return seq.split('').map(aa3).join('');
}

function describeProteinChange(
  refP: string,
  altP: string,
  altHasStop: boolean,
  frameshift: boolean,
  startCodonAffected: boolean,
  /** 読み枠が保たれる場合に想定されるアミノ酸数の増減（塩基の増減 / 3） */
  expectedAaDelta: number,
): ProteinChange {
  if (startCodonAffected) {
    return { consequence: 'start_loss', hgvsP: 'p.(Met1?)', position: 1 };
  }
  if (refP === altP) {
    return { consequence: 'synonymous', hgvsP: 'p.(=)', position: null };
  }

  let p = 0;
  while (p < refP.length && p < altP.length && refP[p] === altP[p]) p += 1;
  const posNum = p + 1;
  const refAa = refP[p] ?? '';
  const altAa = altP[p] ?? '';

  if (frameshift) {
    if (altAa === '*') {
      return { consequence: 'nonsense', hgvsP: `p.(${aa3(refAa)}${posNum}Ter)`, position: posNum };
    }
    return {
      consequence: 'frameshift',
      hgvsP: `p.(${aa3(refAa)}${posNum}${aa3(altAa)}fs${terLabel(altP, p, altHasStop)})`,
      position: posNum,
    };
  }

  // 参照側の終止コドンが失われた場合（読み過ごし）
  if (refAa === '*') {
    return {
      consequence: 'stop_loss',
      hgvsP: `p.(Ter${posNum}${aa3(altAa)}ext${terLabel(altP, p, altHasStop)})`,
      position: posNum,
    };
  }

  // 本来の終止コドンより手前に終止コドンが出現した場合。
  // 「アミノ酸数の実際の増減が、読み枠から想定される増減と異なる」ことで判定する
  // （終止コドン直前のインフレーム欠失を誤ってナンセンスと判定しないため）。
  if (altP.length - refP.length !== expectedAaDelta) {
    if (altAa === '*') {
      return { consequence: 'nonsense', hgvsP: `p.(${aa3(refAa)}${posNum}Ter)`, position: posNum };
    }
    const stopIdx = altP.indexOf('*', p);
    const altSeg = stopIdx >= 0 ? altP.slice(p, stopIdx + 1) : altP.slice(p);
    return {
      consequence: 'nonsense',
      hgvsP: `p.(${aa3(refAa)}${posNum}delins${aa3str(altSeg)})`,
      position: posNum,
    };
  }

  // インフレームの挿入・欠失・置換
  let s = 0;
  while (
    s < refP.length - p &&
    s < altP.length - p &&
    refP[refP.length - 1 - s] === altP[altP.length - 1 - s]
  ) {
    s += 1;
  }
  let refSeg = refP.slice(p, refP.length - s);
  const altSeg = altP.slice(p, altP.length - s);

  if (refSeg.length === 1 && altSeg.length === 1) {
    return {
      consequence: 'missense',
      hgvsP: `p.(${aa3(refSeg)}${posNum}${aa3(altSeg)})`,
      position: posNum,
    };
  }

  if (altSeg.length === 0) {
    const shifted = shift3prime(refP, p, refSeg.length);
    refSeg = refP.slice(shifted, shifted + refSeg.length);
    const from = shifted + 1;
    const to = shifted + refSeg.length;
    const label =
      refSeg.length === 1
        ? `${aa3(refSeg[0])}${from}`
        : `${aa3(refSeg[0])}${from}_${aa3(refSeg[refSeg.length - 1])}${to}`;
    return { consequence: 'inframe_deletion', hgvsP: `p.(${label}del)`, position: from };
  }

  if (refSeg.length === 0) {
    const before = refP.slice(Math.max(0, p - altSeg.length), p);
    if (before === altSeg) {
      const from = p - altSeg.length + 1;
      const to = p;
      const label =
        altSeg.length === 1
          ? `${aa3(altSeg[0])}${from}`
          : `${aa3(altSeg[0])}${from}_${aa3(altSeg[altSeg.length - 1])}${to}`;
      return { consequence: 'inframe_duplication', hgvsP: `p.(${label}dup)`, position: from };
    }
    return {
      consequence: 'inframe_insertion',
      hgvsP: `p.(${aa3(refP[p - 1])}${p}_${aa3(refP[p])}${p + 1}ins${aa3str(altSeg)})`,
      position: p,
    };
  }

  const to = p + refSeg.length;
  const label =
    refSeg.length === 1
      ? `${aa3(refSeg[0])}${posNum}`
      : `${aa3(refSeg[0])}${posNum}_${aa3(refSeg[refSeg.length - 1])}${to}`;
  return {
    consequence: 'inframe_delins',
    hgvsP: `p.(${label}delins${aa3str(altSeg)})`,
    position: posNum,
  };
}

/** 変異型を日本語の一文で説明する */
function buildDescription(a: Omit<VariantAnalysis, 'description'>): string {
  const info = CONSEQUENCE_INFO[a.consequence];
  const gene = a.transcript.gene;
  const pos = a.proteinChangeStart;
  const refAa = pos ? a.refProtein[pos - 1] : '';
  const altAa = pos ? a.altProtein[pos - 1] : '';
  const jaAa = (x: string) => `${aa3(x)}`;

  switch (a.consequence) {
    case 'missense':
      return (
        `${gene} タンパク質の ${pos} 番目のアミノ酸が ${jaAa(refAa)}（${refAa}）から ` +
        `${jaAa(altAa)}（${altAa}）に置き換わる${info.label}です。アミノ酸配列の長さは変わりません。`
      );
    case 'synonymous':
      return (
        `塩基は置換されますが、コドンの意味が変わらないためアミノ酸配列は参照配列と完全に一致します（${info.label}）。`
      );
    case 'nonsense': {
      const at = pos ?? 1;
      const lost = a.refProtein.replace(/\*$/, '').length - at + 1;
      return (
        `${at} 番目のコドンが終止コドン (Ter) に変わる${info.label}です。` +
        `タンパク質は ${at - 1} アミノ酸で途切れ、参照タンパク質より約 ${lost} アミノ酸短くなります。`
      );
    }
    case 'frameshift': {
      const stopAt = a.altHasStop ? a.altProtein.indexOf('*', (pos ?? 1) - 1) + 1 : null;
      const tail = stopAt
        ? `${stopAt - (pos ?? 1) + 1} アミノ酸下流の ${stopAt} 番目に新たな終止コドンが出現します`
        : '転写産物の末端まで終止コドンが現れません';
      return (
        `塩基数が 3 の倍数でない変化のため、${pos} 番目のコドン以降の読み枠がずれる${info.label}です。` +
        `以降のアミノ酸配列は参照配列と全く異なり、${tail}。`
      );
    }
    case 'inframe_deletion':
      return (
        `読み枠を保ったままアミノ酸が欠失する${info.label}です。` +
        `タンパク質の長さは ${a.refProtein.replace(/\*$/, '').length} → ` +
        `${a.altProtein.replace(/\*$/, '').length} アミノ酸になります。`
      );
    case 'inframe_insertion':
    case 'inframe_duplication':
      return (
        `読み枠を保ったままアミノ酸が挿入される${info.label}です。` +
        `タンパク質の長さは ${a.refProtein.replace(/\*$/, '').length} → ` +
        `${a.altProtein.replace(/\*$/, '').length} アミノ酸になります。`
      );
    case 'inframe_delins':
      return `読み枠を保ったままアミノ酸が置き換わる${info.label}です。`;
    case 'start_loss':
      return (
        `開始コドン (ATG) が変化する${info.label}です。` +
        '通常の翻訳開始が妨げられるため、タンパク質産物への影響は本ツールでは予測できません。'
      );
    case 'stop_loss': {
      const ext = a.altProtein.replace(/\*$/, '').length - a.refProtein.replace(/\*$/, '').length;
      return (
        `本来の終止コドンが失われる${info.label}です。翻訳が 3′ 側へ読み過ごされ、` +
        (a.altHasStop
          ? `約 ${ext} アミノ酸長いタンパク質が生じると予測されます。`
          : '転写産物の末端まで終止コドンが現れません。')
      );
    }
    case 'utr5':
      return (
        '開始コドンより上流（5′非翻訳領域）のバリアントです。' +
        'アミノ酸配列そのものは変化しませんが、翻訳効率などに影響する可能性があります。'
      );
    case 'utr3':
      return (
        '終止コドンより下流（3′非翻訳領域）のバリアントです。' +
        'アミノ酸配列そのものは変化しませんが、mRNA の安定性などに影響する可能性があります。'
      );
    case 'splice_site':
      return (
        'エクソン／イントロン境界の保存されたスプライス部位に位置するバリアントです。' +
        '正常なスプライシングが損なわれる可能性がありますが、実際のアミノ酸配列への影響は転写産物の解析が必要です。'
      );
    case 'intronic':
      return (
        'イントロン内に位置するバリアントです。転写産物（mRNA）の配列には含まれないため、' +
        '本ツールではアミノ酸配列への影響を予測できません。'
      );
    default:
      return '参照配列との違いは検出されませんでした。';
  }
}

/** イントロン内バリアントの解析（配列は変更せず、位置情報のみ返す） */
function analyzeIntronic(tx: TranscriptRecord, parsed: ParsedVariant, hgvsC: string): VariantAnalysis {
  const pos = parsed.start.offset !== 0 ? parsed.start : parsed.end;
  const anchorIndex = cPositionToIndex({ ...pos, offset: 0 }, tx);
  const anchor1 = anchorIndex + 1;
  const exonNumber = exonNumberAt(anchor1, tx);
  const distance = Math.abs(pos.offset);
  const isCanonical = distance <= 2;
  const notes: string[] = [];

  const exon = tx.exons.find((e) => anchor1 >= e.start && anchor1 <= e.end);
  if (exon) {
    if (pos.offset > 0 && anchor1 !== exon.end) {
      notes.push(
        `c.${formatPosition({ ...pos, offset: 0 })} はエクソン ${exonNumber} の末端ではありません。` +
          'イントロン位置の記載を確認してください。',
      );
    }
    if (pos.offset < 0 && anchor1 !== exon.start) {
      notes.push(
        `c.${formatPosition({ ...pos, offset: 0 })} はエクソン ${exonNumber} の先頭ではありません。` +
          'イントロン位置の記載を確認してください。',
      );
    }
  }
  notes.push(
    isCanonical
      ? `エクソン境界から ${distance} 塩基のイントロン内（保存されたスプライス部位 ±1〜2）に位置します。`
      : `エクソン境界から ${distance} 塩基離れたイントロン内に位置します。`,
  );

  const refCds = tx.sequence.slice(tx.cdsStart - 1, tx.cdsEnd);
  const refProtein = translate(refCds);
  const consequence: Consequence = isCanonical ? 'splice_site' : 'intronic';

  const base: Omit<VariantAnalysis, 'description'> = {
    transcript: tx,
    parsed,
    hgvsC,
    changeIndex: anchorIndex,
    refBases: '',
    altBases: '',
    altSequence: tx.sequence,
    altCdsStart: tx.cdsStart,
    refCds,
    altCds: refCds,
    refProtein,
    altProtein: refProtein,
    altHasStop: refProtein.endsWith('*'),
    consequence,
    hgvsP: 'p.(?)',
    proteinChangeStart: null,
    proteinComputed: false,
    codonNumber: pos.region === 'cds' ? Math.ceil(pos.base / 3) : null,
    exonNumber,
    notes,
  };
  return { ...base, description: buildDescription(base) };
}

/** バリアントを参照配列に適用し、DNA / タンパク質レベルの結果をまとめる */
export function analyzeVariant(tx: TranscriptRecord, parsed: ParsedVariant): VariantAnalysis {
  const hgvsC = `${tx.accession}(${tx.gene}):${parsed.normalized}`;
  const notes: string[] = [];

  if (parsed.start.offset !== 0 || parsed.end.offset !== 0) {
    return analyzeIntronic(tx, parsed, hgvsC);
  }

  const startIdx = cPositionToIndex(parsed.start, tx);
  const endIdx = cPositionToIndex(parsed.end, tx);
  if (endIdx < startIdx) {
    throw new VariantError('範囲の終了位置が開始位置より前になっています。');
  }

  const seq = tx.sequence;
  let changeIndex = startIdx;
  let refBases = '';
  let altBases = '';

  switch (parsed.kind) {
    case 'substitution': {
      refBases = seq[startIdx];
      altBases = parsed.alt!;
      if (parsed.ref && parsed.ref !== refBases) {
        throw new VariantError(
          `参照配列の不一致: c.${formatPosition(parsed.start)} の塩基は ${tx.accession} では ` +
            `"${refBases}" ですが、入力では "${parsed.ref}" と記載されています。` +
            ' 参照配列のバージョンまたは位置を確認してください。',
        );
      }
      break;
    }
    case 'deletion': {
      refBases = seq.slice(startIdx, endIdx + 1);
      altBases = '';
      if (parsed.ref && parsed.ref !== refBases) {
        throw new VariantError(
          `参照配列の不一致: 欠失範囲の塩基は ${tx.accession} では "${refBases}" ですが、` +
            `入力では "${parsed.ref}" と記載されています。`,
        );
      }
      const shifted = shift3prime(seq, startIdx, refBases.length);
      if (shifted !== startIdx) {
        notes.push(
          'HGVS の 3′ ルールでは、この欠失はより 3′ 側の等価な位置で記載します（配列上の結果は同一です）。',
        );
      }
      break;
    }
    case 'duplication': {
      const dup = seq.slice(startIdx, endIdx + 1);
      if (parsed.ref && parsed.ref !== dup) {
        throw new VariantError(
          `参照配列の不一致: 重複範囲の塩基は ${tx.accession} では "${dup}" ですが、` +
            `入力では "${parsed.ref}" と記載されています。`,
        );
      }
      refBases = dup;
      altBases = dup + dup;
      break;
    }
    case 'insertion': {
      if (endIdx !== startIdx + 1) {
        throw new VariantError(
          '挿入 (ins) は隣接する 2 つの位置で指定してください（例: c.68_69insATG）。',
        );
      }
      changeIndex = endIdx;
      refBases = '';
      altBases = parsed.alt!;
      break;
    }
    case 'delins': {
      refBases = seq.slice(startIdx, endIdx + 1);
      altBases = parsed.alt!;
      if (parsed.ref && parsed.ref !== refBases) {
        throw new VariantError(
          `参照配列の不一致: 欠失範囲の塩基は ${tx.accession} では "${refBases}" ですが、` +
            `入力では "${parsed.ref}" と記載されています。`,
        );
      }
      break;
    }
    case 'inversion': {
      refBases = seq.slice(startIdx, endIdx + 1);
      altBases = reverseComplement(refBases);
      break;
    }
    case 'identity': {
      refBases = seq.slice(startIdx, endIdx + 1);
      altBases = refBases;
      break;
    }
  }

  const altSequence = seq.slice(0, changeIndex) + altBases + seq.slice(changeIndex + refBases.length);
  const lengthDelta = altBases.length - refBases.length;
  const changeEnd = changeIndex + refBases.length; // 0-based, 排他

  // CDS 開始位置の補正（変異が開始コドンより完全に上流にある場合のみずれる）
  const altCdsStart = changeEnd <= tx.cdsStart - 1 ? tx.cdsStart + lengthDelta : tx.cdsStart;

  const refCds = seq.slice(tx.cdsStart - 1, tx.cdsEnd);
  const refProtein = translate(refCds);
  // 変異アレルは CDS 開始から転写産物末端まで翻訳し、最初の終止コドンで打ち切る
  const altProtein = translate(altSequence.slice(altCdsStart - 1));
  const altHasStop = altProtein.endsWith('*');
  const altCds = altSequence.slice(altCdsStart - 1, altCdsStart - 1 + altProtein.length * 3);

  if (tx.proteinSequence && refProtein.replace(/\*$/, '') !== tx.proteinSequence) {
    notes.push(
      '参照 CDS の翻訳結果が GenBank 記載のタンパク質配列と一致しませんでした（レコードの注釈を確認してください）。',
    );
  }
  if (!altHasStop) {
    notes.push('変異アレルでは転写産物の末端までに終止コドンが現れませんでした。');
  }

  // 領域判定
  const inCds = changeEnd > tx.cdsStart - 1 && changeIndex < tx.cdsEnd;
  const startCodonAffected = inCds && changeIndex < tx.cdsStart + 2 && changeEnd > tx.cdsStart - 1;

  let consequence: Consequence;
  let hgvsP: string;
  let proteinChangeStart: number | null;
  let proteinComputed = true;

  if (parsed.kind === 'identity' || (refBases === altBases && lengthDelta === 0)) {
    consequence = 'no_change';
    hgvsP = 'p.(=)';
    proteinChangeStart = null;
  } else if (!inCds) {
    consequence = changeEnd <= tx.cdsStart - 1 ? 'utr5' : 'utr3';
    hgvsP = 'p.(=)';
    proteinChangeStart = null;
    proteinComputed = false;
  } else {
    const frameshift = lengthDelta % 3 !== 0;
    const change = describeProteinChange(
      refProtein,
      altProtein,
      altHasStop,
      frameshift,
      startCodonAffected,
      frameshift ? 0 : lengthDelta / 3,
    );
    consequence = change.consequence;
    hgvsP = change.hgvsP;
    proteinChangeStart = change.position;
  }

  const codonNumber =
    parsed.start.region === 'cds' && inCds ? Math.ceil(parsed.start.base / 3) : null;

  const base: Omit<VariantAnalysis, 'description'> = {
    transcript: tx,
    parsed,
    hgvsC,
    changeIndex,
    refBases,
    altBases,
    altSequence,
    altCdsStart,
    refCds,
    altCds,
    refProtein,
    altProtein,
    altHasStop,
    consequence,
    hgvsP,
    proteinChangeStart,
    proteinComputed,
    codonNumber,
    exonNumber: exonNumberAt(changeIndex + 1, tx),
    notes,
  };

  return { ...base, description: buildDescription(base) };
}

/** 転写産物上の 0-based インデックス → c. 記法の位置文字列 */
export function indexToCLabel(index0: number, tx: TranscriptRecord): string {
  const pos1 = index0 + 1;
  if (pos1 < tx.cdsStart) return `${pos1 - tx.cdsStart}`;
  if (pos1 > tx.cdsEnd) return `*${pos1 - tx.cdsEnd}`;
  return `${pos1 - tx.cdsStart + 1}`;
}
