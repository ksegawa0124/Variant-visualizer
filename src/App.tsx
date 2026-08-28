import { useCallback, useRef, useState } from 'react';
import { VariantForm, type FormValues } from './components/VariantForm';
import { SummaryHeader } from './components/SummaryHeader';
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
  type GenomicMapping,
} from './lib/ncbi';
import { analyzeVariant, VariantError, type VariantAnalysis } from './lib/variant';

const INITIAL: FormValues = {
  assembly: 'GRCh38',
  accession: '',
  gene: '',
  variant: '',
};

interface Result {
  analysis: VariantAnalysis;
  form: FormValues;
  warnings: string[];
}

export default function App() {
  const [form, setForm] = useState<FormValues>(INITIAL);
  const [result, setResult] = useState<Result | null>(null);
  const [genomic, setGenomic] = useState<GenomicMapping | null>(null);
  const [genomicPending, setGenomicPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(true);

  const transcriptCache = useRef(new Map<string, TranscriptRecord>());
  const requestId = useRef(0);

  const loadTranscript = useCallback(async (accession: string) => {
    const cached = transcriptCache.current.get(accession);
    if (cached) return cached;
    const tx = await fetchTranscript(accession);
    transcriptCache.current.set(accession, tx);
    transcriptCache.current.set(tx.accession, tx);
    return tx;
  }, []);

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setError(null);
    setGenomic(null);
    setStatus('入力を確認しています…');

    const gene = form.gene.trim();
    const variantText = form.variant.trim();
    const warnings: string[] = [];

    try {
      // 1. HGVS.c を先に解析する（通信前に入力ミスを検出できる）
      const parsed = parseHgvsC(variantText);

      // 2. 参照配列を決める（未指定なら MANE Select を検索）
      let accession = form.accession.trim() || parsed.accessionHint || '';
      if (!accession) {
        setStatus(`${gene} の MANE Select 参照配列を検索しています…`);
        accession = await findManeSelect(gene);
      }

      // 3. 参照配列レコードを取得
      setStatus(`参照配列 ${accession} を取得しています…`);
      const tx = await loadTranscript(accession);
      if (id !== requestId.current) return;

      // 4. 遺伝子名の整合性を確認
      const geneUpper = gene.toUpperCase();
      const known = [tx.gene, ...tx.geneSynonyms].map((g) => g.toUpperCase());
      if (!known.includes(geneUpper)) {
        warnings.push(
          `入力された遺伝子名 "${gene}" は参照配列 ${tx.accession} の遺伝子 "${tx.gene}" と一致しません。` +
            ' 参照配列の指定を確認してください（解析は指定された参照配列に対して行っています）。',
        );
      }
      if (!tx.isMane && !form.accession.trim()) {
        warnings.push(`${tx.accession} は MANE Select として注釈されていません。`);
      }
      if (form.assembly === 'GRCh37') {
        warnings.push(
          'GRCh37/hg19 が選択されています。転写産物配列自体はアセンブリに依存しませんが、' +
            '表示するゲノム座標を GRCh37 に対応する染色体配列で算出しています。',
        );
      }

      // 5. 解析
      setStatus('参照配列と比較しています…');
      const analysis = analyzeVariant(tx, parsed);
      if (id !== requestId.current) return;

      setResult({ analysis, form: { ...form, accession: tx.accession }, warnings });
      setFormOpen(false);
      setStatus(null);

      // 6. ゲノム座標は付加情報のため、失敗しても解析結果は表示する
      setGenomicPending(true);
      fetchGenomicMapping(`${tx.accession}:${parsed.normalized}`, form.assembly)
        .then((g) => {
          if (id === requestId.current) setGenomic(g);
        })
        .catch(() => {
          if (id === requestId.current) setGenomic(null);
        })
        .finally(() => {
          if (id === requestId.current) setGenomicPending(false);
        });
    } catch (e) {
      if (id !== requestId.current) return;
      setStatus(null);
      if (
        e instanceof HgvsError ||
        e instanceof VariantError ||
        e instanceof NcbiError ||
        e instanceof GenBankError
      ) {
        setError(e.message);
      } else {
        setError(`予期しないエラーが発生しました: ${(e as Error).message}`);
      }
      setResult(null);
      setFormOpen(true);
    }
  }, [form, loadTranscript]);

  const busy = status !== null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-title">
          <h1>Genome Variant Visualizer</h1>
          <p>遺伝子バリアント（HGVS.c）と参照配列を比較し、DNA・アミノ酸配列の変化を可視化します</p>
        </div>
      </header>

      <main>
        {result && (
          <SummaryHeader
            analysis={result.analysis}
            assembly={result.form.assembly}
            genomic={genomic}
            genomicPending={genomicPending}
            warnings={result.warnings}
          />
        )}

        <section className={`panel form-panel${result ? ' compact' : ''}`}>
          {result ? (
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
          {(formOpen || !result) && (
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

        {result && (
          <>
            <OverviewMap analysis={result.analysis} />
            <DnaCompare analysis={result.analysis} />
            <ProteinCompare analysis={result.analysis} />
          </>
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
