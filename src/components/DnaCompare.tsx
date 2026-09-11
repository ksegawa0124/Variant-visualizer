import { useMemo, useState } from 'react';
import { aa3 } from '../lib/codon';
import type { AnalysisRef } from '../lib/compare';
import { variantColor, variantTag } from '../lib/palette';
import { buildDnaView, dnaViewFits, type Cell, type CodonGroup } from '../lib/seqview';
import { indexToCLabel } from '../lib/variant';
import { renderDnaComparison, safeFileName } from '../lib/exportImage';
import { ExportButtons } from './ExportButtons';

interface Props {
  refs: AnalysisRef[];
  activeId: string | null;
  /** 参照配列が全バリアントで共通のときだけ重ねられる */
  canOverlay: boolean;
}

const FLANK_OPTIONS = [15, 30, 60];

export function DnaCompare({ refs, activeId, canOverlay }: Props) {
  const [flank, setFlank] = useState(30);
  const [threeLetter, setThreeLetter] = useState(false);
  const [overlay, setOverlay] = useState(true);

  const multi = refs.length > 1;
  // 変異位置が離れすぎている場合は、重ねても読めないので自動的に 1 件表示へ戻す
  const fits = useMemo(
    () => dnaViewFits(refs.map((r) => r.analysis), flank),
    [refs, flank],
  );
  const overlayOn = multi && canOverlay && overlay && fits;
  const forcedSingle = multi && canOverlay && overlay && !fits;

  const shown = useMemo(() => {
    if (overlayOn) return refs;
    const active = refs.find((r) => r.id === activeId);
    return active ? [active] : [refs[0]];
  }, [overlayOn, refs, activeId]);

  const tx = shown[0].analysis.transcript;
  const view = useMemo(
    () => buildDnaView(shown.map((r) => r.analysis), flank),
    [shown, flank],
  );
  const orderOf = useMemo(
    () => new Map(shown.map((r) => [r.analysis, r.order])),
    [shown],
  );
  const showTags = shown.length > 1;

  const renderRuler = (cells: Cell[]) => (
    <div className="seq-line ruler">
      {cells.map((c) => {
        const show = view.markers.includes(c.index) || (c.index + 1) % 10 === 0;
        return (
          <span key={c.index} className="cell tick">
            {show ? <span className="tick-label">{indexToCLabel(c.index, tx)}</span> : ''}
          </span>
        );
      })}
    </div>
  );

  const renderBases = (cells: Cell[], kind: 'sub' | 'del' | 'ins') => (
    <div className="seq-line bases">
      {cells.map((c) => (
        <span
          key={c.index}
          className={[
            'cell',
            'base',
            `base-${c.base}`,
            c.changed ? `changed ${kind}` : '',
            c.codonIndex === null ? 'utr' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {c.base}
        </span>
      ))}
    </div>
  );

  const renderCodons = (groups: CodonGroup[]) => (
    <div className="seq-line codons">
      {groups.map((g, i) => (
        <span
          key={`${g.codonIndex ?? 'u'}-${i}`}
          className={[
            'codon',
            g.codonIndex === null ? 'utr' : '',
            g.changed ? 'changed' : '',
            g.partial ? 'partial' : '',
            g.aa === '*' ? 'stop' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          // グリッドの列を塩基セルと共有することで、コドン枠のずれが構造的に起きない
          style={{ gridColumn: `span ${g.span}` }}
          title={
            g.codonIndex !== null && g.aa
              ? `コドン ${g.codonIndex + 1} / ${aa3(g.aa)}`
              : '非翻訳領域 (UTR)'
          }
        >
          {g.codonIndex === null ? '' : g.aa ? (threeLetter ? aa3(g.aa) : g.aa) : ''}
          {g.codonIndex !== null && g.span === 3 && (
            <span className="codon-num">{g.codonIndex + 1}</span>
          )}
        </span>
      ))}
    </div>
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>DNA 配列の比較</h3>
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
          <label>
            表示範囲
            <select value={flank} onChange={(e) => setFlank(Number(e.target.value))}>
              {FLANK_OPTIONS.map((f) => (
                <option key={f} value={f}>
                  ±{f} bp
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={threeLetter}
              onChange={(e) => setThreeLetter(e.target.checked)}
            />
            アミノ酸を3文字表記
          </label>
        </div>
      </div>

      <div className="seq-scroll">
        <div className="seq-inner">
          <div className="seq-row">
            <div className="seq-label">
              <span className="seq-name">参照配列</span>
              <span className="seq-sub">{tx.accession}</span>
            </div>
            <div className="seq-track">
              {renderRuler(view.refCells)}
              {/* 参照側は「いずれかのバリアントが触れる塩基」をまとめて示す */}
              {renderBases(view.refCells, view.refChangeClass)}
              {renderCodons(view.refGroups)}
            </div>
          </div>

          {view.rows.map((row) => {
            const order = orderOf.get(row.analysis) ?? 0;
            return (
              <div className="seq-row alt" key={order}>
                <div className="seq-label">
                  <span className="seq-name">
                    {showTags && (
                      <span className="entry-tag small" style={{ background: variantColor(order) }}>
                        {variantTag(order)}
                      </span>
                    )}
                    {showTags ? '' : 'バリアント'}
                  </span>
                  <span className="seq-sub">{row.analysis.parsed.normalized}</span>
                </div>
                <div className="seq-track">
                  {renderBases(row.cells, row.changeClass)}
                  {renderCodons(row.groups)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ul className="legend">
        <li>
          <span className="swatch sub" /> 置換された塩基
        </li>
        <li>
          <span className="swatch del" /> 欠失した塩基（参照配列側）
        </li>
        <li>
          <span className="swatch ins" /> 挿入・重複した塩基
        </li>
        <li>
          <span className="swatch codon-changed" /> アミノ酸が変化するコドン
        </li>
        <li>
          <span className="swatch utr" /> 非翻訳領域 (UTR)
        </li>
      </ul>

      {view.omitted.length > 0 && (
        <p className="hint">
          {view.omitted.map((a) => a.parsed.normalized).join('、')}{' '}
          はイントロン内の変異です。イントロンの塩基は転写産物 (mRNA)
          に含まれないため、変異側の配列は表示できません。
        </p>
      )}
      {forcedSingle && (
        <p className="hint warn">
          変異位置が {'±'}
          {flank} bp の表示範囲に収まらないため、選択中の 1
          件だけを表示しています。上の比較表で行を選ぶと切り替わります。
        </p>
      )}
      <p className="hint">
        コドン枠は各配列の開始コドンを基準に描いています。塩基数が 3
        の倍数でない変化では、変異側のコドン枠が参照側からずれて表示されます（フレームシフト）。
      </p>

      <ExportButtons
        render={() => renderDnaComparison(shown, { flank, threeLetter })}
        fileName={safeFileName(shown, 'DNA')}
      />
    </section>
  );
}
