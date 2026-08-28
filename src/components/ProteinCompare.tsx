import { useMemo, useState } from 'react';
import { aa3, aaClass, AA_JA } from '../lib/codon';
import { CONSEQUENCE_INFO, type VariantAnalysis } from '../lib/variant';

interface Props {
  analysis: VariantAnalysis;
}

function fasta(header: string, seq: string): string {
  const lines: string[] = [`>${header}`];
  for (let i = 0; i < seq.length; i += 60) lines.push(seq.slice(i, i + 60));
  return lines.join('\n');
}

function ResidueCell({
  aa,
  position,
  changed,
  missing,
  threeLetter,
}: {
  aa: string | undefined;
  position: number;
  changed: boolean;
  missing: boolean;
  threeLetter: boolean;
}) {
  if (missing) {
    return <span className="cell residue missing" title={`${position} 番目: 存在しません`} />;
  }
  const letter = aa ?? '';
  return (
    <span
      className={`cell residue class-${aaClass(letter)}${changed ? ' changed' : ''}${
        letter === '*' ? ' stop' : ''
      }`}
      title={`${position} 番目: ${aa3(letter)}（${AA_JA[letter] ?? '不明'}）`}
    >
      {letter === '*' ? '停' : threeLetter ? aa3(letter) : letter}
    </span>
  );
}

export function ProteinCompare({ analysis }: Props) {
  const [threeLetter, setThreeLetter] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const refP = analysis.refProtein;
  const altP = analysis.altProtein;
  const changeStart = analysis.proteinChangeStart;

  const window = useMemo(() => {
    const anchor = (changeStart ?? 1) - 1;
    const before = 12;
    const divergent =
      analysis.consequence === 'frameshift' || analysis.consequence === 'stop_loss' ? 36 : 12;
    const start = Math.max(0, anchor - before);
    const end = Math.min(Math.max(refP.length, altP.length), anchor + divergent + 1);
    return { start, end };
  }, [analysis.consequence, changeStart, refP.length, altP.length]);

  const positions: number[] = [];
  for (let i = window.start; i < window.end; i += 1) positions.push(i);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  };

  if (!analysis.proteinComputed) {
    return (
      <section className="panel">
        <h3>アミノ酸配列の比較</h3>
        <p className="empty">
          {CONSEQUENCE_INFO[analysis.consequence].label}
          のため、本ツールではアミノ酸配列の変化を算出できません。
        </p>
      </section>
    );
  }

  if (changeStart === null) {
    return (
      <section className="panel">
        <h3>アミノ酸配列の比較</h3>
        <p className="empty">
          アミノ酸配列は参照配列と完全に一致します（
          {analysis.refProtein.replace(/\*$/, '').length} アミノ酸）。
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>アミノ酸配列の比較</h3>
        <div className="controls">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={threeLetter}
              onChange={(e) => setThreeLetter(e.target.checked)}
            />
            3文字表記
          </label>
        </div>
      </div>

      <div className="seq-scroll">
        <div className="seq-inner">
          <div className="seq-line ruler protein-ruler">
            <span className="seq-label" />
            {positions.map((i) => (
              <span key={i} className="cell residue tick">
                {(i + 1) % 5 === 0 || i + 1 === changeStart ? (
                  <span className="tick-label">{i + 1}</span>
                ) : (
                  ''
                )}
              </span>
            ))}
          </div>

          <div className="seq-row protein">
            <div className="seq-label">
              <span className="seq-name">参照</span>
              <span className="seq-sub">{analysis.transcript.proteinId ?? ''}</span>
            </div>
            <div className="seq-line">
              {positions.map((i) => (
                <ResidueCell
                  key={i}
                  aa={refP[i]}
                  position={i + 1}
                  changed={refP[i] !== altP[i]}
                  missing={i >= refP.length}
                  threeLetter={threeLetter}
                />
              ))}
            </div>
          </div>

          <div className="seq-row protein alt">
            <div className="seq-label">
              <span className="seq-name">バリアント</span>
              <span className="seq-sub">{analysis.hgvsP}</span>
            </div>
            <div className="seq-line">
              {positions.map((i) => (
                <ResidueCell
                  key={i}
                  aa={altP[i]}
                  position={i + 1}
                  changed={refP[i] !== altP[i]}
                  missing={i >= altP.length}
                  threeLetter={threeLetter}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <ul className="legend">
        <li>
          <span className="swatch class-nonpolar" /> 非極性
        </li>
        <li>
          <span className="swatch class-polar" /> 極性
        </li>
        <li>
          <span className="swatch class-acidic" /> 酸性
        </li>
        <li>
          <span className="swatch class-basic" /> 塩基性
        </li>
        <li>
          <span className="swatch class-stop" /> 終止コドン
        </li>
        <li>
          <span className="swatch residue-changed" /> 参照と異なる残基
        </li>
      </ul>

      <div className="downloads">
        <button
          type="button"
          className="ghost"
          onClick={() =>
            copy(
              'protein',
              fasta(
                `${analysis.transcript.accession}(${analysis.transcript.gene}):${analysis.parsed.normalized} ${analysis.hgvsP}`,
                altP.replace(/\*$/, ''),
              ),
            )
          }
        >
          {copied === 'protein' ? 'コピーしました' : '変異アミノ酸配列を FASTA でコピー'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() =>
            copy(
              'cds',
              fasta(
                `${analysis.transcript.accession}(${analysis.transcript.gene}):${analysis.parsed.normalized} CDS`,
                analysis.altCds,
              ),
            )
          }
        >
          {copied === 'cds' ? 'コピーしました' : '変異 CDS を FASTA でコピー'}
        </button>
      </div>
    </section>
  );
}
