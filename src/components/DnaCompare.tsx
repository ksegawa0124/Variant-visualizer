import { useMemo, useState } from 'react';
import { aa3 } from '../lib/codon';
import { buildDnaView, type Cell, type CodonGroup } from '../lib/seqview';
import { indexToCLabel, type VariantAnalysis } from '../lib/variant';
import { renderDnaComparison, safeFileName } from '../lib/exportImage';
import { ExportButtons } from './ExportButtons';

interface Props {
  analysis: VariantAnalysis;
}

const FLANK_OPTIONS = [15, 30, 60];

export function DnaCompare({ analysis }: Props) {
  const [flank, setFlank] = useState(30);
  const [threeLetter, setThreeLetter] = useState(false);
  const tx = analysis.transcript;

  const view = useMemo(() => buildDnaView(analysis, flank), [analysis, flank]);

  const renderRuler = (cells: Cell[]) => (
    <div className="seq-line ruler">
      {cells.map((c) => {
        const show = c.index === analysis.changeIndex || (c.index + 1) % 10 === 0;
        return (
          <span key={c.index} className="cell tick">
            {show ? <span className="tick-label">{indexToCLabel(c.index, tx)}</span> : ''}
          </span>
        );
      })}
    </div>
  );

  const renderBases = (cells: Cell[], side: 'ref' | 'alt') => {
    // 参照側では欠失を、変異側では挿入・置換を強調する
    const kind = side === 'ref' ? (view.changeClass === 'ins' ? 'sub' : 'del') : view.changeClass;
    return (
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
  };

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
              {renderBases(view.refCells, 'ref')}
              {renderCodons(view.refGroups)}
            </div>
          </div>

          {!view.intronic && (
            <div className="seq-row alt">
              <div className="seq-label">
                <span className="seq-name">バリアント</span>
                <span className="seq-sub">{analysis.parsed.normalized}</span>
              </div>
              <div className="seq-track">
                {renderBases(view.altCells, 'alt')}
                {renderCodons(view.altGroups)}
              </div>
            </div>
          )}
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
      <p className="hint">
        {view.intronic
          ? 'イントロンの塩基は転写産物 (mRNA) に含まれないため、変異側の配列は表示できません。上図は変異位置に隣接するエクソンの配列です。'
          : 'コドン枠は各配列の開始コドンを基準に描いています。塩基数が 3 の倍数でない変化では、変異側のコドン枠が参照側からずれて表示されます（フレームシフト）。'}
      </p>

      <ExportButtons
        render={() => renderDnaComparison(analysis, { flank, threeLetter })}
        fileName={safeFileName(analysis, 'DNA')}
      />
    </section>
  );
}
