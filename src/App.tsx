import { useCallback, useMemo, useRef, useState } from 'react';
import { VariantForm } from './components/VariantForm';
import { newEntry, type FormValues, type VariantEntry } from './lib/entries';
import { SummaryHeader } from './components/SummaryHeader';
import { VariantTable } from './components/VariantTable';
import { OverviewMap } from './components/OverviewMap';
import { DnaCompare } from './components/DnaCompare';
import { ProteinCompare } from './components/ProteinCompare';
import { HgvsError, parseHgvsC } from './lib/hgvs';
import { GenBankError, type TranscriptRecord } from './lib/genbank';
import {
  fetchGenomicMapping,
  fetchTranscript,
  findManeSelect,
  NcbiError,
  type Assembly,
} from './lib/ncbi';
import { analyzeVariant, VariantError } from './lib/variant';
import {
  analysisRefs,
  buildComparisonRows,
  sameTranscript,
  type EntryResult,
} from './lib/compare';

const INITIAL: FormValues = { assembly: 'GRCh38', entries: [newEntry()] };

const ASSEMBLY_LABEL: Record<Assembly, string> = {
  GRCh38: 'GRCh38 / hg38',
  GRCh37: 'GRCh37 / hg19',
};

interface Results {
  assembly: Assembly;
  entries: EntryResult[];
}

function describeError(e: unknown): string {
  if (
    e instanceof HgvsError ||
    e instanceof VariantError ||
    e instanceof NcbiError ||
    e instanceof GenBankError
  ) {
    return e.message;
  }
  return `予期しないエラーが発生しました: ${(e as Error).message}`;
}

export default function App() {
  const [form, setForm] = useState<FormValues>(INITIAL);
  const [results, setResults] = useState<Results | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(true);

  const transcriptCache = useRef(new Map<string, TranscriptRecord>());
  // 同じ遺伝子のバリアントを並べたときに MANE 検索を繰り返さない
  const maneCache = useRef(new Map<string, string>());
  const requestId = useRef(0);

  const resolveMane = useCallback(async (gene: string) => {
    const key = gene.toUpperCase();
    const cached = maneCache.current.get(key);
    if (cached) return cached;
    const accession = await findManeSelect(gene);
    maneCache.current.set(key, accession);
    return accession;
  }, []);

  const loadTranscript = useCallback(async (accession: string) => {
    const cached = transcriptCache.current.get(accession);
    if (cached) return cached;
    const tx = await fetchTranscript(accession);
    transcriptCache.current.set(accession, tx);
    transcriptCache.current.set(tx.accession, tx);
    return tx;
  }, []);

  /** 入力 1 件を解析する（失敗はそのバリアントの行に閉じ込める） */
  const analyzeOne = useCallback(
    async (entry: VariantEntry, index: number, assembly: Assembly): Promise<EntryResult> => {
      const gene = entry.gene.trim();
      const input = { gene, variant: entry.variant.trim(), accession: entry.accession.trim() };
      const base = {
        id: entry.id,
        index,
        input,
        genomic: null,
        genomicPending: false,
      };
      const warnings: string[] = [];
      try {
        // 1. HGVS.c を先に解析する（通信前に入力ミスを検出できる）
        const parsed = parseHgvsC(input.variant);

        // 2. 参照配列を決める（未指定なら MANE Select を検索）
        let accession = input.accession || parsed.accessionHint || '';
        if (!accession) {
          setStatus(`${gene} の MANE Select 参照配列を検索しています…`);
          accession = await resolveMane(gene);
        }

        // 3. 参照配列レコードを取得
        setStatus(`参照配列 ${accession} を取得しています…`);
        const tx = await loadTranscript(accession);

        // 4. 遺伝子名の整合性を確認
        const known = [tx.gene, ...tx.geneSynonyms].map((g) => g.toUpperCase());
        if (!known.includes(gene.toUpperCase())) {
          warnings.push(
            `入力された遺伝子名 "${gene}" は参照配列 ${tx.accession} の遺伝子 "${tx.gene}" と一致しません。` +
              ' 参照配列の指定を確認してください（解析は指定された参照配列に対して行っています）。',
          );
        }
        if (!tx.isMane && !input.accession) {
          warnings.push(`${tx.accession} は MANE Select として注釈されていません。`);
        }
        if (assembly === 'GRCh37') {
          warnings.push(
            'GRCh37/hg19 が選択されています。転写産物配列自体はアセンブリに依存しませんが、' +
              '表示するゲノム座標を GRCh37 に対応する染色体配列で算出しています。',
          );
        }

        // 5. 解析
        return { ...base, analysis: analyzeVariant(tx, parsed), error: null, warnings };
      } catch (e) {
        return { ...base, analysis: null, error: describeError(e), warnings };
      }
    },
    [loadTranscript, resolveMane],
  );

  const run = useCallback(async () => {
    const id = ++requestId.current;
    const assembly = form.assembly;
    const targets = form.entries.filter(
      (e) => e.gene.trim() !== '' && e.variant.trim() !== '',
    );
    setError(null);

    if (targets.length === 0) {
      setStatus(null);
      setError('遺伝子とバリアントの詳細を入力してください。');
      return;
    }

    setStatus('入力を確認しています…');

    // NCBI の負荷を抑えるため 1 件ずつ順に解析する
    const entries: EntryResult[] = [];
    for (const [i, entry] of targets.entries()) {
      if (targets.length > 1) {
        setStatus(`(${i + 1}/${targets.length}) ${entry.gene} ${entry.variant} を解析しています…`);
      }
      const result = await analyzeOne(entry, i, assembly);
      if (id !== requestId.current) return;
      entries.push(result);
    }

    setResults({ assembly, entries });
    setActiveId(entries.find((e) => e.analysis)?.id ?? entries[0].id);
    setStatus(null);

    const failed = entries.filter((e) => e.error);
    if (failed.length === entries.length) {
      setError(
        entries.length === 1
          ? failed[0].error
          : `${entries.length} 件すべてを解析できませんでした。各行の内容を確認してください。`,
      );
      setFormOpen(true);
      return;
    }
    setFormOpen(false);

    // ゲノム座標は付加情報のため、失敗しても解析結果は表示する
    setResults((prev) =>
      prev === null
        ? prev
        : {
            ...prev,
            entries: prev.entries.map((e) => (e.analysis ? { ...e, genomicPending: true } : e)),
          },
    );
    for (const entry of entries) {
      if (!entry.analysis) continue;
      const hgvs = `${entry.analysis.transcript.accession}:${entry.analysis.parsed.normalized}`;
      const genomic = await fetchGenomicMapping(hgvs, assembly).catch(() => null);
      if (id !== requestId.current) return;
      setResults((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              entries: prev.entries.map((e) =>
                e.id === entry.id ? { ...e, genomic, genomicPending: false } : e,
              ),
            },
      );
    }
  }, [form, analyzeOne]);

  const busy = status !== null;

  const refs = useMemo(
    () => (results ? analysisRefs(results.entries) : []),
    [results],
  );
  const rows = useMemo(
    () => (results ? buildComparisonRows(results.entries) : []),
    [results],
  );
  const active = results?.entries.find((e) => e.id === activeId) ?? null;
  const canOverlay = sameTranscript(refs);
  // 参照配列が混在するときは、全体像も選択中の 1 件だけを描く
  const mapRefs = canOverlay ? refs : refs.filter((r) => r.id === activeId);

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>Genome Variant Visualizer</h1>
          <p>
            遺伝子バリアント（HGVS.c）と参照配列を比較し、DNA・アミノ酸配列の変化を可視化します。
            複数のバリアントを並べて比較できます。
          </p>
        </div>
      </header>

      <main>
        {active?.analysis && (
          <SummaryHeader
            analysis={active.analysis}
            assembly={results!.assembly}
            genomic={active.genomic}
            genomicPending={active.genomicPending}
            warnings={active.warnings}
            tag={refs.length > 1 ? active.index : null}
          />
        )}

        <section className={`panel form-panel${results ? ' compact' : ''}`}>
          {results ? (
            <button
              type="button"
              className="disclosure"
              onClick={() => setFormOpen((o) => !o)}
              aria-expanded={formOpen}
            >
              入力条件{formOpen ? 'を閉じる ▲' : 'を変更する ▼'}
            </button>
          ) : (
            <h2>バリアントを入力</h2>
          )}
          {(formOpen || !results) && (
            <VariantForm value={form} onChange={setForm} onSubmit={run} busy={busy} />
          )}
        </section>

        {status && (
          <div className="status" role="status">
            <span className="spinner" aria-hidden="true" />
            {status}
          </div>
        )}

        {error && (
          <div className="error" role="alert">
            <strong>解析できませんでした</strong>
            <p>{error}</p>
          </div>
        )}

        {results && rows.length > 1 && (
          <VariantTable
            rows={rows}
            subtitle={`リファレンスゲノム ${ASSEMBLY_LABEL[results.assembly]}`}
            activeId={activeId}
            onSelect={setActiveId}
          />
        )}

        {refs.length > 0 && (
          <>
            {mapRefs.length > 0 && <OverviewMap refs={mapRefs} activeId={activeId} />}
            <DnaCompare refs={refs} activeId={activeId} canOverlay={canOverlay} />
            <ProteinCompare refs={refs} activeId={activeId} canOverlay={canOverlay} />
          </>
        )}

        {refs.length > 1 && !canOverlay && (
          <p className="hint warn panel">
            参照配列が異なるバリアントが含まれているため、配列の図は選択中の 1
            件のみを表示しています。上の比較表で行を選ぶと切り替わります。
          </p>
        )}
      </main>

      <footer className="app-footer">
        <p>
          配列データは NCBI E-utilities（RefSeq）および NCBI Variation Services
          からブラウザが直接取得しています。
        </p>
        <p className="disclaimer">
          本ツールは配列比較を目的とした研究・教育用であり、臨床診断には使用できません。
          スプライシングへの影響、転写産物の選択、実際の発現産物は評価していません。
        </p>
      </footer>
    </div>
  );
}
