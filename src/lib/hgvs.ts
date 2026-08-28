/**
 * HGVS c. 記法（コーディングDNA参照配列）のパーサ。
 * 対応する変異型: substitution / deletion / duplication / insertion / delins / inversion / identity
 */

export type CRegion = 'utr5' | 'cds' | 'utr3';

/** c. 座標 1 つ分。base は記載どおりの数値（5'UTR は負値、3'UTR は *n の n）、offset はイントロン位置。 */
export interface CPosition {
  region: CRegion;
  base: number;
  offset: number;
  raw: string;
}

export type VariantKind =
  | 'substitution'
  | 'deletion'
  | 'duplication'
  | 'insertion'
  | 'delins'
  | 'inversion'
  | 'identity';

export interface ParsedVariant {
  kind: VariantKind;
  start: CPosition;
  end: CPosition;
  /** substitution の参照塩基、または del/delins で明示された欠失塩基 */
  ref?: string;
  /** substitution / insertion / delins で挿入される塩基 */
  alt?: string;
  /** 入力から復元した正規化表記 */
  normalized: string;
  /** 入力に含まれていた参照配列アクセッション（例: NM_007294.4） */
  accessionHint?: string;
  /** 入力に含まれていた遺伝子名（例: BRCA1） */
  geneHint?: string;
}

export class HgvsError extends Error {}

const POS_RE = /^(\*?)(-?\d+)([+-]\d+)?/;

function parsePosition(text: string): { pos: CPosition; rest: string } {
  const m = POS_RE.exec(text);
  if (!m) {
    throw new HgvsError(`位置の記載を解釈できません: "${text}"`);
  }
  const [full, star, baseStr, offsetStr] = m;
  const base = parseInt(baseStr, 10);
  if (star === '*' && base <= 0) {
    throw new HgvsError(`3'UTR の位置 (*n) は正の数で指定してください: "${full}"`);
  }
  if (star !== '*' && base === 0) {
    throw new HgvsError('c.0 という位置は存在しません（CDS は c.1 から始まります）。');
  }
  const region: CRegion = star === '*' ? 'utr3' : base < 0 ? 'utr5' : 'cds';
  return {
    pos: {
      region,
      base,
      offset: offsetStr ? parseInt(offsetStr, 10) : 0,
      raw: full,
    },
    rest: text.slice(full.length),
  };
}

export function formatPosition(p: CPosition): string {
  const head = p.region === 'utr3' ? `*${p.base}` : `${p.base}`;
  const tail = p.offset === 0 ? '' : p.offset > 0 ? `+${p.offset}` : `${p.offset}`;
  return head + tail;
}

function samePosition(a: CPosition, b: CPosition): boolean {
  return a.region === b.region && a.base === b.base && a.offset === b.offset;
}

function assertBases(seq: string, label: string): string {
  const up = seq.toUpperCase();
  if (!/^[ACGTU]+$/.test(up)) {
    throw new HgvsError(`${label}に塩基 (A/C/G/T) 以外の文字が含まれています: "${seq}"`);
  }
  return up.replace(/U/g, 'T');
}

/**
 * HGVS c. 記法を解析する。
 * "NM_007294.4(BRCA1):c.68_69del" のような接頭辞付きの記載も受け付ける。
 */
export function parseHgvsC(input: string): ParsedVariant {
  let text = input.trim().replace(/\s+/g, '');
  if (!text) throw new HgvsError('バリアントを入力してください。');

  let accessionHint: string | undefined;
  let geneHint: string | undefined;

  // 接頭辞 "NM_007294.4(BRCA1):" / "NM_007294.4:" を取り除く
  const prefix = /^([A-Z]{2}_[\d.]+)?(?:\(([A-Za-z0-9_.-]+)\))?:/.exec(text);
  if (prefix) {
    accessionHint = prefix[1];
    geneHint = prefix[2];
    text = text.slice(prefix[0].length);
  }

  const typeMatch = /^([cgmnrp])\./i.exec(text);
  if (typeMatch) {
    const t = typeMatch[1].toLowerCase();
    if (t !== 'c') {
      const names: Record<string, string> = {
        g: 'ゲノム座標 (g.)',
        m: 'ミトコンドリア座標 (m.)',
        n: '非コードRNA座標 (n.)',
        r: 'RNA座標 (r.)',
        p: 'タンパク質座標 (p.)',
      };
      throw new HgvsError(
        `${names[t]} は未対応です。コーディングDNA参照配列の記法 (c.) で入力してください。`,
      );
    }
    text = text.slice(typeMatch[0].length);
  }

  const { pos: start, rest } = parsePosition(text);
  let end = start;
  let body = rest;

  if (body.startsWith('_')) {
    const parsed = parsePosition(body.slice(1));
    end = parsed.pos;
    body = parsed.rest;
  }

  const normalizedRange =
    samePosition(start, end) ? formatPosition(start) : `${formatPosition(start)}_${formatPosition(end)}`;

  const build = (
    kind: VariantKind,
    suffix: string,
    extra: Partial<ParsedVariant> = {},
  ): ParsedVariant => ({
    kind,
    start,
    end,
    normalized: `c.${normalizedRange}${suffix}`,
    accessionHint,
    geneHint,
    ...extra,
  });

  // 置換: 68A>T
  const sub = /^([ACGTUacgtu])>([ACGTUacgtu])$/.exec(body);
  if (sub) {
    if (!samePosition(start, end)) {
      throw new HgvsError('置換 (>) は 1 塩基の位置のみ指定できます。範囲指定には delins を使用してください。');
    }
    const ref = assertBases(sub[1], '参照塩基');
    const alt = assertBases(sub[2], '変異塩基');
    if (ref === alt) throw new HgvsError('参照塩基と変異塩基が同一です。');
    return build('substitution', `${ref}>${alt}`, { ref, alt });
  }

  // delins: 68_70delinsTT / 68delAGinsTT
  const delins = /^del([ACGTUacgtu]*|\d*)ins([ACGTUacgtu]+)$/.exec(body);
  if (delins) {
    const ref = /^[ACGTUacgtu]+$/.test(delins[1]) ? assertBases(delins[1], '欠失塩基') : undefined;
    const alt = assertBases(delins[2], '挿入塩基');
    return build('delins', `delins${alt}`, { ref, alt });
  }

  // 欠失: 68del / 68delA / 68_69delAG / 68_70del3
  const del = /^del([ACGTUacgtu]*|\d*)$/.exec(body);
  if (del) {
    const ref = /^[ACGTUacgtu]+$/.test(del[1]) ? assertBases(del[1], '欠失塩基') : undefined;
    return build('deletion', 'del', { ref });
  }

  // 重複: 68dup / 68_69dup / 68dupA
  const dup = /^dup([ACGTUacgtu]*|\d*)$/.exec(body);
  if (dup) {
    const ref = /^[ACGTUacgtu]+$/.test(dup[1]) ? assertBases(dup[1], '重複塩基') : undefined;
    return build('duplication', 'dup', { ref });
  }

  // 挿入: 68_69insATG
  const ins = /^ins([ACGTUacgtu]+)$/.exec(body);
  if (ins) {
    if (samePosition(start, end)) {
      throw new HgvsError(
        '挿入 (ins) は挿入部位を挟む 2 つの位置で指定してください（例: c.68_69insATG）。',
      );
    }
    const alt = assertBases(ins[1], '挿入塩基');
    return build('insertion', `ins${alt}`, { alt });
  }

  // 逆位: 68_70inv
  if (/^inv([ACGTUacgtu]*|\d*)$/.test(body)) {
    if (samePosition(start, end)) {
      throw new HgvsError('逆位 (inv) は 2 塩基以上の範囲で指定してください（例: c.68_70inv）。');
    }
    return build('inversion', 'inv');
  }

  // 変化なし: 68=
  if (body === '=') {
    return build('identity', '=');
  }

  throw new HgvsError(
    `変異の記載 "${body || '(なし)'}" を解釈できません。` +
      ' 対応形式: c.76A>T, c.76del, c.76_78del, c.76dup, c.76_77insG, c.76_78delinsAC, c.76_78inv',
  );
}
