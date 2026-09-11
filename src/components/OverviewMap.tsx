import { variantColor, variantTag } from '../lib/palette';
import type { AnalysisRef } from '../lib/compare';

interface Props {
  refs: AnalysisRef[];
  activeId: string | null;
}

const W = 1000;
const PAD = 44;
const TRACK = W - PAD * 2;
const ROW_H = 30;

/** 転写産物とタンパク質の全体像を俯瞰する SVG マップ（複数バリアントを重ねて描く） */
export function OverviewMap({ refs, activeId }: Props) {
  const tx = refs[0].analysis.transcript;
  const len = tx.sequence.length;
  const x = (pos: number) => PAD + (pos / len) * TRACK;
  const multi = refs.length > 1;

  const cdsX1 = x(tx.cdsStart - 1);
  const cdsX2 = x(tx.cdsEnd);

  const refAaLen = refs[0].analysis.refProtein.replace(/\*$/, '').length;
  const proteinRefs = refs.filter((r) => r.analysis.proteinComputed);
  const maxAa = Math.max(
    refAaLen,
    ...proteinRefs.map((r) => r.analysis.altProtein.replace(/\*$/, '').length),
  );
  const px = (aa: number) => PAD + (aa / maxAa) * TRACK;

  const protH = 14 + (1 + proteinRefs.length) * ROW_H + 18;

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

          {/* バリアント位置（入力順の色で重ねる） */}
          {refs.map((r) => {
            const a = r.analysis;
            const vx = x(a.changeIndex);
            const vw = Math.max(2, x(a.changeIndex + Math.max(a.refBases.length, 1)) - vx);
            const cx = vx + vw / 2;
            const dim = activeId !== null && r.id !== activeId;
            const color = multi ? variantColor(r.order) : undefined;
            return (
              <g key={r.id} opacity={dim ? 0.45 : 1}>
                <rect x={vx} y={24} width={vw} height={44} className="map-variant" fill={color} />
                <path
                  d={`M ${cx - 6} 18 L ${cx + 6} 18 L ${cx} 26 Z`}
                  className="map-pointer"
                  fill={color}
                />
                <text x={cx} y={13} className="map-label" textAnchor="middle" fill={color}>
                  {multi ? variantTag(r.order) : a.parsed.normalized}
                </text>
              </g>
            );
          })}

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

      {proteinRefs.length > 0 && (
        <div className="map-block">
          <div className="map-title">
            タンパク質 <span className="muted">{tx.proteinId ?? ''}</span>
          </div>
          <svg viewBox={`0 0 ${W} ${protH}`} className="map-svg" role="img" aria-label="タンパク質長の比較">
            <text x={PAD - 8} y={26} className="map-side" textAnchor="end">
              参照
            </text>
            <rect x={PAD} y={14} width={px(refAaLen) - PAD} height={18} rx={3} className="map-prot-ref" />
            <text x={px(refAaLen) + 6} y={27} className="map-tick" textAnchor="start">
              {refAaLen.toLocaleString()} aa
            </text>

            {proteinRefs.map((r, i) => {
              const a = r.analysis;
              const y = 14 + (i + 1) * ROW_H;
              const altAaLen = a.altProtein.replace(/\*$/, '').length;
              const changeAa = a.proteinChangeStart;
              const fsLike = a.consequence === 'frameshift' || a.consequence === 'stop_loss';
              const dim = activeId !== null && r.id !== activeId;
              const color = multi ? variantColor(r.order) : undefined;
              return (
                <g key={r.id} opacity={dim ? 0.45 : 1}>
                  <text x={PAD - 8} y={y + 13} className="map-side" textAnchor="end" fill={color}>
                    {multi ? variantTag(r.order) : '変異'}
                  </text>
                  {changeAa === null ? (
                    <rect x={PAD} y={y} width={px(altAaLen) - PAD} height={18} rx={3} className="map-prot-ref" />
                  ) : (
                    <>
                      <rect
                        x={PAD}
                        y={y}
                        width={Math.max(0, px(changeAa - 1) - PAD)}
                        height={18}
                        rx={3}
                        className="map-prot-ref"
                      />
                      <rect
                        x={px(changeAa - 1)}
                        y={y}
                        width={Math.max(1.5, px(altAaLen) - px(changeAa - 1))}
                        height={18}
                        rx={3}
                        className={fsLike ? 'map-prot-fs' : 'map-prot-alt'}
                        fill={color}
                      />
                      <line
                        x1={px(changeAa - 1)}
                        x2={px(changeAa - 1)}
                        y1={y - 4}
                        y2={y + 22}
                        className="map-change-line"
                        stroke={color}
                      />
                    </>
                  )}
                  <text x={px(altAaLen) + 6} y={y + 13} className="map-tick" textAnchor="start">
                    {altAaLen.toLocaleString()} aa
                    {altAaLen !== refAaLen && (
                      <tspan className={altAaLen < refAaLen ? 'delta-down' : 'delta-up'}>
                        {' '}
                        ({altAaLen > refAaLen ? '+' : ''}
                        {altAaLen - refAaLen})
                      </tspan>
                    )}
                    {changeAa !== null && (
                      <tspan className="muted-text"> ・{changeAa} 番目から</tspan>
                    )}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}
