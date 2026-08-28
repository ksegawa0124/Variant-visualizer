/** 標準遺伝暗号（NCBI genetic code 1）とアミノ酸表記のユーティリティ */

export const CODON_TABLE: Record<string, string> = {
  TTT: 'F', TTC: 'F', TTA: 'L', TTG: 'L',
  CTT: 'L', CTC: 'L', CTA: 'L', CTG: 'L',
  ATT: 'I', ATC: 'I', ATA: 'I', ATG: 'M',
  GTT: 'V', GTC: 'V', GTA: 'V', GTG: 'V',
  TCT: 'S', TCC: 'S', TCA: 'S', TCG: 'S',
  CCT: 'P', CCC: 'P', CCA: 'P', CCG: 'P',
  ACT: 'T', ACC: 'T', ACA: 'T', ACG: 'T',
  GCT: 'A', GCC: 'A', GCA: 'A', GCG: 'A',
  TAT: 'Y', TAC: 'Y', TAA: '*', TAG: '*',
  CAT: 'H', CAC: 'H', CAA: 'Q', CAG: 'Q',
  AAT: 'N', AAC: 'N', AAA: 'K', AAG: 'K',
  GAT: 'D', GAC: 'D', GAA: 'E', GAG: 'E',
  TGT: 'C', TGC: 'C', TGA: '*', TGG: 'W',
  CGT: 'R', CGC: 'R', CGA: 'R', CGG: 'R',
  AGT: 'S', AGC: 'S', AGA: 'R', AGG: 'R',
  GGT: 'G', GGC: 'G', GGA: 'G', GGG: 'G',
};

/** 1文字表記 → 3文字表記 */
export const AA3: Record<string, string> = {
  A: 'Ala', R: 'Arg', N: 'Asn', D: 'Asp', C: 'Cys',
  Q: 'Gln', E: 'Glu', G: 'Gly', H: 'His', I: 'Ile',
  L: 'Leu', K: 'Lys', M: 'Met', F: 'Phe', P: 'Pro',
  S: 'Ser', T: 'Thr', W: 'Trp', Y: 'Tyr', V: 'Val',
  '*': 'Ter', X: 'Xaa',
};

/** 1文字表記 → 日本語名 */
export const AA_JA: Record<string, string> = {
  A: 'アラニン', R: 'アルギニン', N: 'アスパラギン', D: 'アスパラギン酸',
  C: 'システイン', Q: 'グルタミン', E: 'グルタミン酸', G: 'グリシン',
  H: 'ヒスチジン', I: 'イソロイシン', L: 'ロイシン', K: 'リジン',
  M: 'メチオニン', F: 'フェニルアラニン', P: 'プロリン', S: 'セリン',
  T: 'トレオニン', W: 'トリプトファン', Y: 'チロシン', V: 'バリン',
  '*': '終止コドン', X: '不明',
};

/** アミノ酸の性質分類（配色に使用） */
export type AaClass = 'nonpolar' | 'polar' | 'acidic' | 'basic' | 'stop' | 'unknown';

const AA_CLASS_MAP: Record<string, AaClass> = {
  G: 'nonpolar', A: 'nonpolar', V: 'nonpolar', L: 'nonpolar', I: 'nonpolar',
  M: 'nonpolar', F: 'nonpolar', W: 'nonpolar', P: 'nonpolar',
  S: 'polar', T: 'polar', C: 'polar', Y: 'polar', N: 'polar', Q: 'polar',
  D: 'acidic', E: 'acidic',
  K: 'basic', R: 'basic', H: 'basic',
  '*': 'stop',
};

export function aaClass(aa: string): AaClass {
  return AA_CLASS_MAP[aa] ?? 'unknown';
}

export function aa3(aa: string): string {
  return AA3[aa] ?? 'Xaa';
}

/** アミノ酸1文字配列 → 3文字表記の連結（例: "MDL" → "MetAspLeu"） */
export function aa3seq(seq: string): string {
  return seq.split('').map(aa3).join('');
}

export function translateCodon(codon: string): string {
  return CODON_TABLE[codon.toUpperCase()] ?? 'X';
}

/**
 * 塩基配列を翻訳する。
 * @param stopAtTer true なら最初の終止コドンで打ち切る（終止コドン自身は含む）
 */
export function translate(dna: string, stopAtTer = true): string {
  const out: string[] = [];
  for (let i = 0; i + 3 <= dna.length; i += 3) {
    const aa = translateCodon(dna.slice(i, i + 3));
    out.push(aa);
    if (stopAtTer && aa === '*') break;
  }
  return out.join('');
}

export function reverseComplement(dna: string): string {
  const comp: Record<string, string> = {
    A: 'T', T: 'A', G: 'C', C: 'G', N: 'N',
    a: 't', t: 'a', g: 'c', c: 'g', n: 'n',
  };
  return dna.split('').reverse().map((b) => comp[b] ?? 'N').join('');
}
