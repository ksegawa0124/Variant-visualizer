/** NCBI GenBank フラットファイル（mRNA RefSeq レコード）の最小パーサ */

export interface ExonFeature {
  /** 転写産物上の 1-based 開始・終了 */
  start: number;
  end: number;
  number?: string;
}

export interface TranscriptRecord {
  /** バージョン付きアクセッション（例: NM_007294.4） */
  accession: string;
  definition: string;
  gene: string;
  geneSynonyms: string[];
  geneId?: string;
  /** MANE Select レコードかどうか */
  isMane: boolean;
  /** 転写産物の全長塩基配列（大文字） */
  sequence: string;
  /** CDS の 1-based 開始・終了（転写産物座標） */
  cdsStart: number;
  cdsEnd: number;
  proteinId?: string;
  /** GenBank に記載された参照タンパク質配列（検証に使用） */
  proteinSequence?: string;
  exons: ExonFeature[];
  organism: string;
}

export class GenBankError extends Error {}

/** FEATURES ブロックを (key, location, qualifiers) に分解する */
interface RawFeature {
  key: string;
  location: string;
  qualifiers: Record<string, string[]>;
}

function parseFeatures(lines: string[]): RawFeature[] {
  const features: RawFeature[] = [];
  let current: RawFeature | null = null;
  let pendingQualifier: { name: string; value: string } | null = null;

  const flushQualifier = () => {
    if (current && pendingQualifier) {
      const clean = pendingQualifier.value.replace(/^"|"$/g, '');
      (current.qualifiers[pendingQualifier.name] ??= []).push(clean);
    }
    pendingQualifier = null;
  };

  for (const line of lines) {
    // 特徴キーは 5 カラム目から始まる
    const featureStart = /^ {5}(\S+)\s+(.*)$/.exec(line);
    if (featureStart) {
      flushQualifier();
      if (current) features.push(current);
      current = { key: featureStart[1], location: featureStart[2].trim(), qualifiers: {} };
      continue;
    }
    const cont = /^ {21}(.*)$/.exec(line);
    if (!cont || !current) continue;
    const content = cont[1];
    const qual = /^\/([^=]+)=?(.*)$/.exec(content);
    if (qual) {
      flushQualifier();
      pendingQualifier = { name: qual[1], value: qual[2] };
    } else if (pendingQualifier) {
      // 折り返し行。配列系の修飾子は空白を挟まずに連結する
      const joiner = /^(translation|peptide)$/.test(pendingQualifier.name) ? '' : ' ';
      pendingQualifier.value += joiner + content;
    } else {
      current.location += content;
    }
  }
  flushQualifier();
  if (current) features.push(current);
  return features;
}

function parseSimpleRange(location: string): { start: number; end: number } {
  const m = /^<?(\d+)\.\.>?(\d+)$/.exec(location.trim());
  if (!m) {
    throw new GenBankError(
      `未対応の位置表現です: "${location}"。単一の連続範囲を持つ mRNA レコードのみ対応しています。`,
    );
  }
  return { start: parseInt(m[1], 10), end: parseInt(m[2], 10) };
}

export function parseGenBank(text: string): TranscriptRecord {
  if (!text.trim() || /^Error|Failed to retrieve/i.test(text.trim())) {
    throw new GenBankError('NCBI から配列レコードを取得できませんでした。');
  }
  const lines = text.split(/\r?\n/);

  const versionLine = lines.find((l) => l.startsWith('VERSION'));
  const accession = versionLine ? versionLine.replace('VERSION', '').trim().split(/\s+/)[0] : '';
  if (!accession) throw new GenBankError('レコードからアクセッション番号を取得できませんでした。');

  const definition = lines
    .join('\n')
    .match(/^DEFINITION\s+([\s\S]*?)\n(?=[A-Z])/m)?.[1]
    .replace(/\s+/g, ' ')
    .trim() ?? '';

  const organism = lines.find((l) => l.startsWith('  ORGANISM'))?.replace('  ORGANISM', '').trim() ?? '';

  const keywords = lines
    .join('\n')
    .match(/^KEYWORDS\s+([\s\S]*?)\n(?=[A-Z])/m)?.[1]
    .replace(/\s+/g, ' ') ?? '';
  const isMane = /MANE Select/i.test(keywords);

  const featStart = lines.findIndex((l) => l.startsWith('FEATURES'));
  const originIdx = lines.findIndex((l) => l.startsWith('ORIGIN'));
  if (featStart < 0 || originIdx < 0) {
    throw new GenBankError('レコードの形式が想定と異なります（FEATURES / ORIGIN が見つかりません）。');
  }

  const features = parseFeatures(lines.slice(featStart + 1, originIdx));

  const cds = features.find((f) => f.key === 'CDS');
  if (!cds) {
    throw new GenBankError(
      'この参照配列には CDS（コード領域）がありません。タンパク質をコードする転写産物 (NM_*) を指定してください。',
    );
  }
  const { start: cdsStart, end: cdsEnd } = parseSimpleRange(cds.location);

  const geneFeature = features.find((f) => f.key === 'gene');
  const gene = cds.qualifiers.gene?.[0] ?? geneFeature?.qualifiers.gene?.[0] ?? '';
  const geneSynonyms = (geneFeature?.qualifiers.gene_synonym?.[0] ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  const geneId = geneFeature?.qualifiers.db_xref
    ?.find((x) => x.startsWith('GeneID:'))
    ?.replace('GeneID:', '');

  const exons: ExonFeature[] = features
    .filter((f) => f.key === 'exon')
    .map((f) => {
      const { start, end } = parseSimpleRange(f.location);
      return { start, end, number: f.qualifiers.number?.[0] };
    });

  // ORIGIN ブロックの配列を連結
  const sequence = lines
    .slice(originIdx + 1)
    .filter((l) => !l.startsWith('//'))
    .map((l) => l.replace(/\d/g, '').replace(/\s/g, ''))
    .join('')
    .toUpperCase()
    .replace(/U/g, 'T');

  if (!sequence) throw new GenBankError('レコードから塩基配列を取得できませんでした。');
  if (cdsEnd > sequence.length) {
    throw new GenBankError('CDS の位置が配列長を超えています（レコードが破損している可能性があります）。');
  }

  return {
    accession,
    definition,
    gene,
    geneSynonyms,
    geneId,
    isMane,
    sequence,
    cdsStart,
    cdsEnd,
    proteinId: cds.qualifiers.protein_id?.[0],
    proteinSequence: cds.qualifiers.translation?.[0]?.replace(/\s/g, ''),
    exons,
    organism,
  };
}
