import { useState } from 'react';
import { comparisonTsv, type ComparisonRow } from '../lib/compare';
import { renderVariantTable, downloadCanvas, copyCanvasToClipboard } from '../lib/exportImage';

interface Props {
  rows: ComparisonRow[];
  /** 画像の副題（リファレンスゲノムなど） */
  subtitle: string;
  activeId: string | null;
  onSelect: (id: string) => void;
}

const HEADINGS = [
  '',
  '遺伝子',
  '参照配列',
  'HGVS.c',
  '変異型',
  'HGVS.p',
  '位置',
  'タンパク質長',
  'ゲノム座標',
];

export function VariantTable({ rows, subtitle, activeId, onSelect }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = (key: string) => {
    setCopied(key);
    setError(null);
    setTimeout(() => setCopied(null), 2000);
  };

  const exportImage = async (kind: 'download' | 'copy') => {
    try {
      const canvas = renderVariantTable(rows, subtitle);
      if (kind === 'download') {
        await downloadCanvas(canvas, `variant_comparison_${rows.length}.png`);
        flash('png');
      } else {
        await copyCanvasToClipboard(canvas);
        flash('pngcopy');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(comparisonTsv(rows));
      flash('tsv');
    } catch {
      setError('クリップボードにコピーできませんでした。');
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>バリアント比較</h3>
        <span className="field-hint">行を選ぶと下の詳細が切り替わります</span>
      </div>

      <div className="table-scroll">
        <table className="compare-table">
          <thead>
            <tr>
              {HEADINGS.map((h, i) => (
                <th key={h || `c${i}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`${row.id === activeId ? 'active' : ''}${row.error ? ' failed' : ''}`}
                onClick={() => onSelect(row.id)}
                tabIndex={0}
                role="button"
                aria-pressed={row.id === activeId}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(row.id);
                  }
                }}
              >
                <td>
                  <span className="entry-tag" style={{ background: row.color }}>
                    {row.tag}
                  </span>
                </td>
                <td>{row.gene}</td>
                <td className="mono">{row.accession}</td>
                <td className="mono strong">{row.hgvsC}</td>
                {row.error ? (
                  <td className="error-cell" colSpan={5}>
                    解析できません: {row.error}
                  </td>
                ) : (
                  <>
                    <td>
                      <span className={`chip severity-${row.severity}`}>{row.consequence}</span>
                    </td>
                    <td className="mono">{row.hgvsP}</td>
                    <td>{row.location}</td>
                    <td>{row.protein}</td>
                    <td className="mono small">
                      {row.genomicPending ? <span className="muted">照会中…</span> : row.genomic}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="downloads">
        <button type="button" className="ghost" onClick={() => exportImage('download')}>
          {copied === 'png' ? '保存しました' : '比較表を PNG で保存'}
        </button>
        <button type="button" className="ghost" onClick={() => exportImage('copy')}>
          {copied === 'pngcopy' ? 'コピーしました' : '比較表の画像をコピー'}
        </button>
        <button type="button" className="ghost" onClick={copyTsv}>
          {copied === 'tsv' ? 'コピーしました' : '表を TSV でコピー'}
        </button>
        {error && <span className="export-error">{error}</span>}
      </div>
    </section>
  );
}
