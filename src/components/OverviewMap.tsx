import type { VariantAnalysis } from '../lib/variant';

interface Props {
  analysis: VariantAnalysis;
}

const W = 1000;
const PAD = 44;
const TRACK = W - PAD * 2;

/** 転写産物とタンパク質の全体像を俯瞰する SVG マップ */
export function OverviewMap({ analysis }: Props) {
  const tx = analysis.transcript;
  const len = tx.sequence.length;
  const x = (pos: number) => PAD + (pos / len) * TRACK;

  const cdsX1 = x(tx.cdsStart - 1);
  const cdsX2 = x(tx.cdsEnd);
  const varX = x(analysis.changeIndex);
  const varW = Math.max(2, x(analysis.changeIndex + Math.max(analysis.refBases.length, 1)) - varX);

  const refAaLen = analysis.refProtein.replace(/\*$/, '').length;
  const altAaLen = analysis.altProtein.replace(/\*$/, '').length;
  const maxAa = Math.max(refAaLen, altAaLen);
  const px = (aa: number) => PAD + (aa / maxAa) * TRACK;
  const changeAa = analysis.proteinChangeStart;

  const frameshiftLike =
    analysis.consequence === 'frameshift' || analysis.consequence === 'stop_loss';

  return (
    <section className="panel">
      <h3>全体像</h3>

      <div className="map-block">
        <div className="map-title">
          転写産物 (mRNA) <span className="muted">{tx.accession}・{len.toLocaleString()} bp</span>
        </div>
        <svg viewBox={`0 0 ${W} 96`} className="map-svg" role="img" aria-label="転写産物上のバリアント位置">
          {/* UTR / CDS */}
          <rect x={PAD} y={40} width={cdsX1 - PAD} height={12} rx={2} className="map-utr" />
          <rect x={cdsX2} y={40} width={PAD + TRACK - cdsX2} height={12} rx={2} className="map-utr" />
          <rect x={cdsX1} y={32} width={cdsX2 - cdsX1} height={28} rx={3} className="map-cds" />

          {/* エクソン境界 */}
          {tx.exons.slice(0, -1).map((e) => (
            <line key={e.end} x1={x(e.end)} x2={x(e.end)} y1={32} y2={60} className="map-exon-line" />
          ))}

          {/* バリアント位置 */}
          <rect x={varX} y={24} width={varW} height={44} className="map-variant" />
          <path d={`M ${varX + varW / 2 - 6} 18 L ${varX + varW / 2 + 6} 18 L ${varX + varW / 2} 26 Z`} className="map-pointer" />
          <text x={varX + varW / 2} y={13} className="map-label" textAnchor="middle">
            {analysis.parsed.normalized}
          </text>

          {/* 目盛り */}
          <text x={PAD} y={78} className="map-tick" textAnchor="start">
            1
          </text>
          <text x={cdsX1} y={78} className="map-tick" textAnchor="middle">
            c.1（開始コドン）
          </text>
          <text x={cdsX2} y={78} className="map-tick" textAnchor="middle">
            終止コドン
          </text>
          <text x={PAD + TRACK} y={78} className="map-tick" textAnchor="end">
            {len.toLocaleString()}
          </text>
          <text x={PAD} y={92} className="map-tick muted-text" textAnchor="start">
            5′UTR
          </text>
          <text x={(cdsX1 + cdsX2) / 2} y={92} className="map-tick muted-text" textAnchor="middle">
            CDS（エクソン {tx.exons.length} 個）
          </text>
          <text x={PAD + TRACK} y={92} className="map-tick muted-text" textAnchor="end">
            3′UTR
          </text>
        </svg>
      </div>

      {analysis.proteinComputed && (
        <div className="map-block">
          <div className="map-title">
            タンパク質 <span className="muted">{tx.proteinId ?? ''}</span>
          </div>
          <svg viewBox={`0 0 ${W} 92`} className="map-svg" role="img" aria-label="タンパク質長の比較">
            <text x={PAD - 8} y={26} className="map-side" textAnchor="end">
              参照
            </text>
            <rect x={PAD} y={14} width={px(refAaLen) - PAD} height={18} rx={3} className="map-prot-ref" />

            <text x={PAD - 8} y={62} className="map-side" textAnchor="end">
              変異
            </text>
            {changeAa !== null && (
              <>
                <rect
                  x={PAD}
                  y={50}
                  width={Math.max(0, px(changeAa - 1) - PAD)}
                  height={18}
                  rx={3}
                  className="map-prot-ref"
                />
                <rect
                  x={px(changeAa - 1)}
                  y={50}
                  width={Math.max(1.5, px(altAaLen) - px(changeAa - 1))}
                  height={18}
                  rx={3}
                  className={frameshiftLike ? 'map-prot-fs' : 'map-prot-alt'}
                />
                <line x1={px(changeAa - 1)} x2={px(changeAa - 1)} y1={10} y2={72} className="map-change-line" />
                <text x={px(changeAa - 1)} y={84} className="map-tick" textAnchor="middle">
                  {changeAa} 番目
                </text>
              </>
            )}
            {changeAa === null && (
              <rect x={PAD} y={50} width={px(altAaLen) - PAD} height={18} rx={3} className="map-prot-ref" />
            )}

            <text x={px(refAaLen) + 6} y={27} className="map-tick" textAnchor="start">
              {refAaLen.toLocaleString()} aa
            </text>
            <text x={px(altAaLen) + 6} y={63} className="map-tick" textAnchor="start">
              {altAaLen.toLocaleString()} aa
              {altAaLen !== refAaLen && (
                <tspan className={altAaLen < refAaLen ? 'delta-down' : 'delta-up'}>
                  {' '}
                  ({altAaLen > refAaLen ? '+' : ''}
                  {altAaLen - refAaLen})
                </tspan>
              )}
            </text>
          </svg>
        </div>
      )}
    </section>
  );
}
