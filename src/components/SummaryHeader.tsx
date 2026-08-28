import { useState } from 'react';
import { CONSEQUENCE_INFO, type VariantAnalysis } from '../lib/variant';
import type { Assembly, GenomicMapping } from '../lib/ncbi';

interface Props {
  analysis: VariantAnalysis;
  assembly: Assembly;
  genomic: GenomicMapping | null;
  genomicPending: boolean;
  warnings: string[];
}

const ASSEMBLY_LABEL: Record<Assembly, string> = {
  GRCh38: 'GRCh38 / hg38',
  GRCh37: 'GRCh37 / hg19',
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      title={`${label}をコピー`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? 'コピーしました' : 'コピー'}
    </button>
  );
}

export function SummaryHeader({ analysis, assembly, genomic, genomicPending, warnings }: Props) {
  const tx = analysis.transcript;
  const info = CONSEQUENCE_INFO[analysis.consequence];

  return (
    <section className="summary" aria-label="バリアントの概要">
      {/* 1. バリアント（参照配列・遺伝子・HGVS.c） */}
      <div className="summary-variant">
        <h2>
          <span className="accession">{tx.accession}</span>
          <span className="paren">(</span>
          <span className="gene">{tx.gene}</span>
          <span className="paren">)</span>
          <span className="sep">:</span>
          <span className="hgvsc">{analysis.parsed.normalized}</span>
        </h2>
        <CopyButton text={analysis.hgvsC} label="HGVS.c" />
      </div>

      <div className="summary-badges">
        <span className={`badge severity-${info.severity}`}>{info.label}</span>
        <span className="badge protein" title="予測されるタンパク質レベルの変化">
          {analysis.hgvsP}
        </span>
        {tx.isMane && (
          <span className="badge mane" title="MANE Select（NCBI と Ensembl が共同で選定した代表転写産物）">
            MANE Select
          </span>
        )}
      </div>

      {/* 2. バリアントの簡易な説明 */}
      <p className="summary-description">{analysis.description}</p>

      <dl className="summary-meta">
        <div>
          <dt>リファレンスゲノム</dt>
          <dd>{ASSEMBLY_LABEL[assembly]}</dd>
        </div>
        <div>
          <dt>ゲノム座標</dt>
          <dd>
            {genomic ? (
              <code>{genomic.hgvsG}</code>
            ) : genomicPending ? (
              <span className="muted">照会中…</span>
            ) : (
              <span className="muted">取得できませんでした</span>
            )}
          </dd>
        </div>
        <div>
          <dt>タンパク質</dt>
          <dd>
            {tx.proteinId ?? '—'}（
            {analysis.refProtein.replace(/\*$/, '').length}
            {analysis.proteinComputed && (
              <>
                {' → '}
                {analysis.altProtein.replace(/\*$/, '').length}
              </>
            )}{' '}
            aa）
          </dd>
        </div>
        <div>
          <dt>位置</dt>
          <dd>
            {analysis.exonNumber ? `エクソン ${analysis.exonNumber}` : '—'}
            {analysis.codonNumber ? ` / コドン ${analysis.codonNumber}` : ''}
          </dd>
        </div>
      </dl>

      {(warnings.length > 0 || analysis.notes.length > 0) && (
        <ul className="notes">
          {[...warnings, ...analysis.notes].map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
