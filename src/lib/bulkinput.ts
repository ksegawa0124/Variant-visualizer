/**
 * 「まとめて入力」欄の 1 行 1 バリアントを読み取る。
 *
 * 論文や検査報告書からの貼り付けを想定し、次のような書き方をすべて受け付ける。
 *   NM_007294.4(BRCA1):c.68_69del
 *   BRCA1 c.68_69del
 *   BRCA1, c.181T>G
 *   c.5266dup            ← 遺伝子名は直前の行から引き継ぐ
 */

export interface BulkEntry {
  gene: string;
  variant: string;
  accession: string;
}

/** NM_007294.4(BRCA1):c.68_69del 形式 */
const PREFIXED = /^([A-Z]{2}_\d+(?:\.\d+)?)\s*(?:\(\s*([A-Za-z0-9._-]+)\s*\))?\s*:\s*(.+)$/;
const ACCESSION = /^[A-Z]{2}_\d+(?:\.\d+)?$/;
/** c. / n. / g. など、いずれかの座標系の記述に見えるトークン */
const VARIANT_LIKE = /^[cngmrp]\./i;

function looksLikeVariant(token: string): boolean {
  return VARIANT_LIKE.test(token) || /[>=]|del|dup|ins|inv/i.test(token);
}

export function parseBulkVariants(text: string): BulkEntry[] {
  const out: BulkEntry[] = [];
  let lastGene = '';
  let lastAccession = '';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const prefixed = PREFIXED.exec(line);
    if (prefixed) {
      const [, accession, gene, variant] = prefixed;
      lastAccession = accession;
      if (gene) lastGene = gene;
      out.push({ gene: gene ?? lastGene, variant: variant.trim(), accession });
      continue;
    }

    const tokens = line.split(/[\s,;、]+/).filter(Boolean);
    let gene = '';
    let accession = '';
    const variantParts: string[] = [];
    for (const token of tokens) {
      if (!accession && ACCESSION.test(token)) accession = token;
      else if (looksLikeVariant(token)) variantParts.push(token);
      else if (!gene) gene = token;
    }

    const variant = variantParts.join('');
    if (variant === '') continue;

    if (gene) lastGene = gene;
    if (accession) lastAccession = accession;
    out.push({
      gene: gene || lastGene,
      variant,
      // 明示された参照配列は以降の行にも引き継ぐ（同じ転写産物を並べることが多いため）
      accession: accession || lastAccession,
    });
  }

  return out;
}
