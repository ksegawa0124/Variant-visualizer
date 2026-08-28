import { useMemo, useState } from 'react';
import { aa3 } from '../lib/codon';
import { indexToCLabel, type VariantAnalysis } from '../lib/variant';

interface Props {
  analysis: VariantAnalysis;
}

interface Cell {
  base: string;
  /** その配列上の 0-based インデックス */
  index: number;
  codonIndex: number | null;
  changed: boolean;
}

interface CodonGroup {
  codonIndex: number | null;
  span: number;
  aa: string | null;
  changed: boolean;
  partial: boolean;
}

const FLANK_OPTIONS = [15, 30, 60];

function buildCells(
  seq: string,
  winStart: number,
  count: number,
  cdsStart: number,
  cdsEndExclusive: number,
  changeFrom: number,
  changeTo: number,
): Cell[] {
  const cells: Cell[] = [];
  for (let i = winStart; i < Math.min(seq.length, winStart + count); i += 1) {
    const inCds = i >= cdsStart - 1 && i < cdsEndExclusive;
    cells.push({
      base: seq[i],
      index: i,
      codonIndex: inCds ? Math.floor((i - (cdsStart - 1)) / 3) : null,
      changed: i >= changeFrom && i < changeTo,
    });
  }
  return cells;
}

function groupCodons(cells: Cell[], protein: string, otherProtein: string): CodonGroup[] {
  const groups: CodonGroup[] = [];
  for (const cell of cells) {
    const last = groups[groups.length - 1];
    if (last && last.codonIndex === cell.codonIndex && cell.codonIndex !== null) {
      last.span += 1;
      continue;
    }
    if (last && last.codonIndex === null && cell.codonIndex === null) {
      last.span += 1;
      continue;
    }
    const aa = cell.codonIndex !== null ? (protein[cell.codonIndex] ?? null) : null;
    groups.push({
      codonIndex: cell.codonIndex,
      span: 1,
      aa,
      changed:
        cell.codonIndex !== null &&
        (protein[cell.codonIndex] ?? '') !== (otherProtein[cell.codonIndex] ?? ''),
      partial: false,
    });
  }
  for (const g of groups) {
    if (g.codonIndex !== null && g.span < 3) g.partial = true;
  }
  return groups;
}

export function DnaCompare({ analysis }: Props) {
  const [flank, setFlank] = useState(30);
  const [threeLetter, setThreeLetter] = useState(false);
  const tx = analysis.transcript;

  const view = useMemo(() => {
    const refLen = analysis.refBases.length;
    const altLen = analysis.altBases.length;

    // ウィンドウ開始はコドン境界に揃える（読み枠が視覚的に一致するように）
    let winStart = Math.max(0, analysis.changeIndex - flank);
    const cdsOffset = tx.cdsStart - 1;
    if (winStart > cdsOffset) {
      winStart -= (winStart - cdsOffset) % 3;
    }
    const count = Math.max(refLen, altLen) + (analysis.changeIndex - winStart) + flank;

    const refCells = buildCells(
      tx.sequence,
      winStart,
      count,
      tx.cdsStart,
      tx.cdsEnd,
      analysis.changeIndex,
      analysis.changeIndex + refLen,
    );
    const altCells = buildCells(
      analysis.altSequence,
      winStart,
      count,
      analysis.altCdsStart,
      analysis.altCdsStart - 1 + analysis.altProtein.length * 3,
      analysis.changeIndex,
      analysis.changeIndex + altLen,
    );
    return {
      winStart,
      refCells,
      altCells,
      refGroups: groupCodons(refCells, analysis.refProtein, analysis.altProtein),
      altGroups: groupCodons(altCells, analysis.altProtein, analysis.refProtein),
    };
  }, [analysis, flank, tx]);

  // イントロン内のバリアントは転写産物配列に現れないため、参照側のみを表示する
  const intronic = analysis.consequence === 'intronic' || analysis.consequence === 'splice_site';

  const changeClass =
    analysis.altBases.length > analysis.refBases.length
      ? 'ins'
      : analysis.altBases.length < analysis.refBases.length
        ? 'del'
        : 'sub';

  const renderRuler = (cells: Cell[]) => (
    <div className="seq-line ruler">
      {cells.map((c) => {
        const label = indexToCLabel(c.index, tx);
        const show = c.index === analysis.changeIndex || (c.index + 1) % 10 === 0;
        return (
          <span key={c.index} className="cell tick">
            {show ? <span className="tick-label">{label}</span> : ''}
          </span>
        );
      })}
    </div>
  );

  const renderBases = (cells: Cell[], kind: 'ref' | 'alt') => (
    <div className="seq-line bases">
      {cells.map((c) => (
        <span
          key={c.index}
          className={`cell base base-${c.base}${c.changed ? ` changed ${kind === 'ref' ? (changeClass === 'ins' ? 'sub' : 'del') : changeClass}` : ''}${
            c.codonIndex === null ? ' utr' : ''
          }`}
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
          className={`codon${g.codonIndex === null ? ' utr' : ''}${g.changed ? ' changed' : ''}${
            g.partial ? ' partial' : ''
          }${g.aa === '*' ? ' stop' : ''}`}
          style={{ width: `calc(var(--cell) * ${g.span})` }}
          title={
            g.codonIndex !== null && g.aa
              ? `コドン ${g.codonIndex + 1} / ${aa3(g.aa)}`
              : '非翻訳領域 (UTR)'
          }
        >
          {g.codonIndex === null
            ? ''
            : g.aa
              ? threeLetter
                ? aa3(g.aa)
                : g.aa
              : ''}
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

          {!intronic && (
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
        {intronic
          ? 'イントロンの塩基は転写産物 (mRNA) に含まれないため、変異側の配列は表示できません。上図は変異位置に隣接するエクソンの配列です。'
          : 'コドン枠は各配列の開始コドンを基準に描いています。塩基数が 3 の倍数でない変化では、変異側のコドン枠が参照側からずれて表示されます（フレームシフト）。'}
      </p>
    </section>
  );
}
