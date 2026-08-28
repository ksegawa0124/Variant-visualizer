/** NCBI E-utilities / Variation Services へのクライアント（すべてブラウザから直接呼び出す） */

import { parseGenBank, type TranscriptRecord } from './genbank';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const VARIATION = 'https://api.ncbi.nlm.nih.gov/variation/v0';

/** NCBI の利用規約に沿った識別子（E-utilities は tool/email の指定を推奨している） */
const TOOL = 'genome-variant-visualizer';

export class NcbiError extends Error {}

export type Assembly = 'GRCh38' | 'GRCh37';

/** ヒト染色体の RefSeq アクセッション接頭辞（NC_000001〜NC_000024） */
const ASSEMBLY_CHR_PREFIX = 'NC_0000';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * NCBI は API キーなしの場合 3 リクエスト/秒に制限しており、混雑時は 429 や 5xx を返す。
 * 一時的な失敗は短い待機を挟んで数回だけ再試行する。
 */
async function fetchText(url: string, signal?: AbortSignal, attempt = 0): Promise<string> {
  const MAX_ATTEMPTS = 3;
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    if (attempt + 1 < MAX_ATTEMPTS) {
      await sleep(600 * (attempt + 1));
      return fetchText(url, signal, attempt + 1);
    }
    throw new NcbiError(
      'NCBI への通信に失敗しました。ネットワーク接続を確認して、しばらくしてから再試行してください。',
    );
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt + 1 < MAX_ATTEMPTS) {
      await sleep(800 * (attempt + 1));
      return fetchText(url, signal, attempt + 1);
    }
    throw new NcbiError(
      `NCBI が一時的に応答できない状態です (HTTP ${res.status})。` +
        ' 少し時間をおいてから再試行してください。',
    );
  }
  if (!res.ok) {
    throw new NcbiError(`NCBI からの応答がエラーでした (HTTP ${res.status})。`);
  }
  return res.text();
}

/**
 * NCBI はエラー時に制御文字を含む不正な JSON を返すことがあるため、
 * そのまま JSON.parse せず、失敗したら制御文字を除いて読み直す。
 */
function parseJsonLenient<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    try {
      // 文字列リテラル内の生の制御文字（改行など）を空白に置き換える。
      // 制御文字にマッチさせるのがここでの目的なので、この規則は意図的に無効化する。
      // eslint-disable-next-line no-control-regex
      const cleaned = text.replace(/[\u0000-\u001F]/g, ' ');
      return JSON.parse(cleaned) as T;
    } catch {
      throw new NcbiError(
        'NCBI からの応答を解釈できませんでした。少し時間をおいてから再試行してください。',
      );
    }
  }
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  return parseJsonLenient<T>(await fetchText(url, signal));
}

/** 遺伝子名から MANE Select の転写産物アクセッションを検索する */
export async function findManeSelect(gene: string, signal?: AbortSignal): Promise<string> {
  const term = `${gene}[gene] AND "MANE Select"[keyword] AND "Homo sapiens"[orgn] AND biomol_mrna[prop] AND srcdb_refseq[prop]`;
  const url =
    `${EUTILS}/esearch.fcgi?db=nuccore&retmode=json&retmax=5&tool=${TOOL}` +
    `&term=${encodeURIComponent(term)}`;
  const data = await fetchJson<{ esearchresult?: { idlist?: string[]; ERROR?: string } }>(url, signal);
  if (data.esearchresult?.ERROR) {
    throw new NcbiError(
      `NCBI の検索がエラーを返しました: ${data.esearchresult.ERROR.trim()}` +
        ' 少し時間をおいてから再試行してください。',
    );
  }
  const ids = data.esearchresult?.idlist ?? [];
  if (ids.length === 0) {
    throw new NcbiError(
      `遺伝子 "${gene}" の MANE Select 参照配列が見つかりませんでした。` +
        ' 遺伝子記号（HGNC シンボル）が正しいか確認するか、参照配列 (NM_...) を直接指定してください。',
    );
  }
  const summaryUrl = `${EUTILS}/esummary.fcgi?db=nuccore&retmode=json&tool=${TOOL}&id=${ids[0]}`;
  const summary = await fetchJson<{ result?: Record<string, { accessionversion?: string }> }>(
    summaryUrl,
    signal,
  );
  const accession = summary.result?.[ids[0]]?.accessionversion;
  if (!accession) {
    throw new NcbiError(`遺伝子 "${gene}" の参照配列アクセッションを取得できませんでした。`);
  }
  return accession;
}

/** RefSeq 転写産物レコード（配列 + CDS + エクソン構造）を取得する */
export async function fetchTranscript(
  accession: string,
  signal?: AbortSignal,
): Promise<TranscriptRecord> {
  const url =
    `${EUTILS}/efetch.fcgi?db=nuccore&rettype=gb&retmode=text&tool=${TOOL}` +
    `&id=${encodeURIComponent(accession)}`;
  const text = await fetchText(url, signal);
  if (/^\s*$/.test(text) || /Failed to understand id|cannot get document summary/i.test(text)) {
    throw new NcbiError(
      `参照配列 "${accession}" を取得できませんでした。アクセッション番号（例: NM_007294.4）を確認してください。`,
    );
  }
  return parseGenBank(text);
}

export interface GenomicMapping {
  assembly: Assembly;
  /** 染色体の RefSeq アクセッション（例: NC_000017.11） */
  sequenceId: string;
  chromosome?: string;
  /** 1-based のゲノム開始位置 */
  position: number;
  deleted: string;
  inserted: string;
  /** g. 記法の要約 */
  hgvsG: string;
}

interface Spdi {
  seq_id: string;
  position: number;
  deleted_sequence: string;
  inserted_sequence: string;
}

/** NC_000001.11 → "1", NC_000023.11 → "X" */
function chromosomeFromRefSeq(seqId: string): string | undefined {
  const m = /^NC_0000(\d{2})\./.exec(seqId);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  if (n >= 1 && n <= 22) return String(n);
  if (n === 23) return 'X';
  if (n === 24) return 'Y';
  return undefined;
}

/**
 * 染色体 RefSeq の版から対象アセンブリの表現を選ぶ。
 * 同一染色体では最新版が GRCh38、その 1 つ前の版が GRCh37 に対応する
 * （例: chr17 は GRCh38 = NC_000017.11 / GRCh37 = NC_000017.10）。
 */
function pickForAssembly(spdis: Spdi[], assembly: Assembly): Spdi | undefined {
  const genomic = spdis.filter((s) => s.seq_id.startsWith(ASSEMBLY_CHR_PREFIX));
  if (genomic.length === 0) return undefined;

  // 最も多く現れる染色体（＝目的の染色体）に絞ってから版を比較する
  const base = genomic[0].seq_id.split('.')[0];
  const versions = genomic
    .filter((s) => s.seq_id.startsWith(`${base}.`))
    .map((s) => ({ spdi: s, version: parseInt(s.seq_id.split('.')[1] ?? '0', 10) }))
    .sort((a, b) => b.version - a.version);

  if (versions.length === 0) return undefined;
  if (assembly === 'GRCh38') return versions[0].spdi;
  const previous = versions.find((v) => v.version === versions[0].version - 1);
  return previous?.spdi;
}

/**
 * SPDI（両端が展開された表現）から冗長な塩基を取り除く。
 * 接頭辞を先に切り詰めることで、HGVS の 3′ ルールに沿った最も 3′ 側の表現になる。
 */
function trimSpdi(spdi: Spdi): { position: number; deleted: string; inserted: string } {
  let { position } = spdi;
  let deleted = spdi.deleted_sequence;
  let inserted = spdi.inserted_sequence;

  while (deleted.length > 0 && inserted.length > 0 && deleted[0] === inserted[0]) {
    deleted = deleted.slice(1);
    inserted = inserted.slice(1);
    position += 1;
  }
  while (
    deleted.length > 0 &&
    inserted.length > 0 &&
    deleted[deleted.length - 1] === inserted[inserted.length - 1]
  ) {
    deleted = deleted.slice(0, -1);
    inserted = inserted.slice(0, -1);
  }
  return { position, deleted, inserted };
}

function toHgvsG(spdi: Spdi, chromosome?: string): string {
  const { position, deleted, inserted } = trimSpdi(spdi);
  const label = chromosome ? `${spdi.seq_id}(chr${chromosome})` : spdi.seq_id;
  const start = position + 1; // SPDI は 0-based、HGVS は 1-based

  if (deleted.length === 1 && inserted.length === 1) {
    return `${label}:g.${start}${deleted}>${inserted}`;
  }
  if (inserted.length === 0) {
    const range = deleted.length === 1 ? `${start}` : `${start}_${start + deleted.length - 1}`;
    return `${label}:g.${range}del`;
  }
  if (deleted.length === 0) {
    // 挿入は挿入部位を挟む 2 塩基で表す
    return `${label}:g.${start - 1}_${start}ins${inserted}`;
  }
  const range = deleted.length === 1 ? `${start}` : `${start}_${start + deleted.length - 1}`;
  return `${label}:g.${range}delins${inserted}`;
}

/**
 * HGVS c. 記法からゲノム座標を取得する（表示用の付加情報）。
 * 失敗しても解析自体は続行できるよう、呼び出し側で null を許容すること。
 */
export async function fetchGenomicMapping(
  hgvsC: string,
  assembly: Assembly,
  signal?: AbortSignal,
): Promise<GenomicMapping | null> {
  const ctxUrl = `${VARIATION}/hgvs/${encodeURIComponent(hgvsC)}/contextuals`;
  const ctx = await fetchJson<{ data?: { spdis?: Spdi[] } }>(ctxUrl, signal);
  const first = ctx.data?.spdis?.[0];
  if (!first) return null;

  const spdiStr = `${first.seq_id}:${first.position}:${first.deleted_sequence}:${first.inserted_sequence}`;
  const allUrl = `${VARIATION}/spdi/${encodeURIComponent(spdiStr)}/all_equivalent_contextual`;
  const all = await fetchJson<{ data?: { spdis?: Spdi[] } }>(allUrl, signal);
  const spdis = all.data?.spdis ?? [];

  const picked = pickForAssembly(spdis, assembly);
  if (!picked) return null;
  const chromosome = chromosomeFromRefSeq(picked.seq_id);
  return {
    assembly,
    sequenceId: picked.seq_id,
    chromosome,
    position: picked.position + 1,
    deleted: picked.deleted_sequence,
    inserted: picked.inserted_sequence,
    hgvsG: toHgvsG(picked, chromosome),
  };
}
