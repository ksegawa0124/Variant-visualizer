import { useMemo, useState } from 'react';
import { aa3, aaClass, AA_JA } from '../lib/codon';
import type { AnalysisRef } from '../lib/compare';
import { variantColor, variantTag } from '../lib/palette';
import { buildProteinView, proteinViewFits } from '../lib/seqview';
import { renderProteinComparison, safeFileName } from '../lib/exportImage';
import { ExportButtons } from './ExportButtons';
import { CONSEQUENCE_INFO } from '../lib/variant';

interface Props {
  refs: AnalysisRef[];
  activeId: string | null;
  /** 参照配列が全バリアントで共通のときだけ重ねられる */
  canOverlay: boolean;
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

export function ProteinCompare({ refs, activeId, canOverlay }: Props) {
  const [threeLetter, setThreeLetter] = useState(false);
  const [overlay, setOverlay] = useState(true);

  const multi = refs.length > 1;
  // 変化位置が離れすぎている場合は、重ねても読めないので自動的に 1 件表示へ戻す
  const fits = useMemo(
    () => proteinViewFits(refs.filter((r) => r.analysis.proteinComputed).map((r) => r.analysis)),
    [refs],
  );
  const overlayOn = multi && canOverlay && overlay && fits;
  const forcedSingle = multi && canOverlay && overlay && !fits;

  const shown = useMemo(() => {
    if (overlayOn) return refs;
    const active = refs.find((r) => r.id === activeId);
    return active ? [active] : [refs[0]];
  }, [overlayOn, refs, activeId]);

  const computable = shown.filter((r) => r.analysis.proteinComputed);
  const changed = computable.filter((r) => r.analysis.proteinChangeStart !== null);

  const { positions, markers } = useMemo(
    () => buildProteinView((changed.length > 0 ? changed : computable).map((r) => r.analysis)),
    [changed, computable],
  );

  const uncomputable = shown.filter((r) => !r.analysis.proteinComputed);

  if (computable.length === 0) {
    return (
      <section className="panel">
        <h3>アミノ酸配列の比較</h3>
        <p className="empty">
          {uncomputable.map((r) => CONSEQUENCE_INFO[r.analysis.consequence].label).join('、')}
          のため、本ツールではアミノ酸配列の変化を算出できません。
        </p>
      </section>
    );
  }

  if (changed.length === 0) {
    return (
      <section className="panel">
        <h3>アミノ酸配列の比較</h3>
        <p className="empty">
          {multi ? '選択中のバリアントはいずれも' : ''}
          アミノ酸配列が参照配列と完全に一致します（
          {computable[0].analysis.refProtein.replace(/\*$/, '').length} アミノ酸）。
        </p>
      </section>
    );
  }

  const refP = computable[0].analysis.refProtein;
  const showTags = computable.length > 1;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>アミノ酸配列の比較</h3>
        <div className="controls">
          {multi && canOverlay && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={overlay}
                onChange={(e) => setOverlay(e.target.checked)}
              />
              全バリアントを重ねる
            </label>
          )}
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
                {(i + 1) % 5 === 0 || markers.includes(i + 1) ? (
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
              <span className="seq-sub">{computable[0].analysis.transcript.proteinId ?? ''}</span>
            </div>
            <div className="seq-line">
              {positions.map((i) => (
                <ResidueCell
                  key={i}
                  aa={refP[i]}
                  position={i + 1}
                  changed={false}
                  missing={i >= refP.length}
                  threeLetter={threeLetter}
                />
              ))}
            </div>
          </div>

          {computable.map((r) => {
            const altP = r.analysis.altProtein;
            return (
              <div className="seq-row protein alt" key={r.order}>
                <div className="seq-label">
                  <span className="seq-name">
                    {showTags ? (
                      <span className="entry-tag small" style={{ background: variantColor(r.order) }}>
                        {variantTag(r.order)}
                      </span>
                    ) : (
                      'バリアント'
                    )}
                  </span>
                  <span className="seq-sub">{r.analysis.hgvsP}</span>
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
            );
          })}
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

      {forcedSingle && (
        <p className="hint warn">
          アミノ酸の変化位置が離れているため、選択中の 1
          件だけを表示しています。上の比較表で行を選ぶと切り替わります。
        </p>
      )}

      {uncomputable.length > 0 && (
        <p className="hint">
          {uncomputable.map((r) => r.analysis.parsed.normalized).join('、')}{' '}
          はアミノ酸配列の変化を算出できないため、この図には含めていません。
        </p>
      )}

      <ExportButtons
        render={() => renderProteinComparison(shown, { threeLetter })}
        fileName={safeFileName(shown, 'protein')}
      />
    </section>
  );
}
