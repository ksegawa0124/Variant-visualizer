import { useMemo } from 'react';
import {
  CNV_INFO,
  classifyGenes,
  exonText,
  genesToTsv,
  RELATION_LABEL,
  type CnvResult,
} from '../lib/cnv';
import { cytobandLabel, formatRange, formatSpan, PRINT_THEME, SCREEN_THEME } from '../lib/chrommap';
import { renderCnvMap } from '../lib/cnvmap';
import { downloadText } from '../lib/download';
import { svgToCanvas } from '../lib/svgRaster';
import { ucscBrowserUrl } from '../lib/ucsc';
import { ExportButtons } from './ExportButtons';

interface Props {
  result: CnvResult;
  assemblyLabel: string;
}

/** 例: chr17 → 17 番染色体 / chrX → X 染色体 */
function chromosomeName(chrom: string): string {
  const n = chrom.replace(/^chr/, '');
  return /^\d+$/.test(n) ? `${n} 番染色体` : `${n} 染色体`;
}

const RELATION_ORDER = { contained: 0, left: 1, spans: 1, right: 1, outside: 2 } as const;

function useCnvModel(result: CnvResult) {
  const { region, chromosome, window: win, genes } = result;
  const hits = useMemo(() => (genes ? classifyGenes(genes, region) : []), [genes, region]);
  const inside = useMemo(() => hits.filter((h) => h.relation !== 'outside'), [hits]);
  const model = useMemo(
    () => ({ chromosome, region, window: win, hits, genesFailed: genes === null }),
    [chromosome, region, win, hits, genes],
  );
  return { hits, inside, model };
}

/** ページ上部の概要カード（種類・範囲・サイズ・含まれる遺伝子の数） */
export function CnvSummary({ result, assemblyLabel }: Props) {
  const { region, chromosome } = result;
  const info = CNV_INFO[region.type];
  const { inside } = useCnvModel(result);
  const len = region.end - region.start;
  const contained = inside.filter((h) => h.relation === 'contained');
  const cut = inside.filter((h) => h.relation !== 'contained');
  const coding = (list: typeof inside) => list.filter((h) => h.coding).length;

  return (
    <section
      className="summary cnv-summary"
      aria-label="CNV の概要"
      style={{ borderLeftColor: info.color }}
    >
      <div className="summary-variant">
        <h2>
          <span className="cnv-type" style={{ background: info.color }}>
            {info.label}
          </span>
          <span className="hgvsc">{formatRange(region.chrom, region.start, region.end)}</span>
        </h2>
      </div>

      <p className="summary-description">
        {info.ja}。{chromosomeName(region.chrom)}の{' '}
        <strong>{cytobandLabel(chromosome, region.start, region.end)}</strong> にあたる{' '}
        {formatSpan(len)} の範囲です。
        {result.genes &&
          (inside.length === 0
            ? ' この範囲に重なる遺伝子（RefSeq Select）はありません。'
            : ` 範囲に重なる遺伝子は ${inside.length} 個です。`)}
      </p>

      <dl className="summary-meta">
        <div>
          <dt>リファレンスゲノム</dt>
          <dd>{assemblyLabel}</dd>
        </div>
        <div>
          <dt>サイズ</dt>
          <dd>
            {len.toLocaleString('en-US')} bp（{formatSpan(len)}）
          </dd>
        </div>
        <div>
          <dt>範囲に完全に含まれる遺伝子</dt>
          <dd>
            {result.genes ? `${contained.length}（うちタンパク質コード ${coding(contained)}）` : '—'}
          </dd>
        </div>
        <div>
          <dt>ブレークポイントで切断される遺伝子</dt>
          <dd>{result.genes ? `${cut.length}（うちタンパク質コード ${coding(cut)}）` : '—'}</dd>
        </div>
      </dl>
    </section>
  );
}

/** 染色体上の位置と周辺の図、および範囲内の遺伝子の一覧 */
export function CnvDetails({ result, assemblyLabel }: Props) {
  const { region, chromosome, window: win, assembly } = result;
  const info = CNV_INFO[region.type];
  const { inside, model } = useCnvModel(result);

  const screen = useMemo(() => renderCnvMap(model, { theme: SCREEN_THEME }), [model]);
  const rows = useMemo(
    () =>
      [...inside].sort(
        (a, b) =>
          RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] ||
          a.gene.txStart - b.gene.txStart,
      ),
    [inside],
  );

  const band = cytobandLabel(chromosome, region.start, region.end);
  const range = formatRange(region.chrom, region.start, region.end);
  const stem = `CNV_${region.chrom}_${region.start + 1}-${region.end}_${info.label}_${assembly}`;

  const exportMap = () => {
    const out = renderCnvMap(model, {
      theme: PRINT_THEME,
      legend: true,
      header: {
        title: `CNV の位置と周辺の遺伝子 — ${info.label}`,
        subtitle: [assemblyLabel, range, band, formatSpan(region.end - region.start)].join('　|　'),
      },
    });
    return svgToCanvas(out.svg, out.width, out.height, 2);
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>染色体上の位置と周辺の遺伝子</h3>
          <span className="field-hint">
            染色体 → CNV の範囲（前後 5% を含む）の順に拡大しています
          </span>
        </div>

        {/* 図は自前の SVG 文字列。内容は入力した座標と、エスケープ済みの遺伝子名だけ */}
        <div className="chrom-map" dangerouslySetInnerHTML={{ __html: screen.svg }} />

        <ul className="legend">
          <li>
            <span className="swatch" style={{ background: info.color, borderColor: info.color }} />{' '}
            CNV（{info.label}）の範囲
          </li>
          <li>
            <span className="swatch map-legend-cds" /> 範囲内の遺伝子
          </li>
          <li>
            <span className="swatch" style={{ background: info.color, borderColor: info.color }} />{' '}
            ブレークポイントで切断される遺伝子
          </li>
          <li>
            <span className="swatch map-legend-out" /> 範囲外の遺伝子
          </li>
          <li>
            <span className="map-legend-intron" aria-hidden="true">
              ›››
            </span>{' '}
            矢印は転写方向（太い部分がコード領域、細い部分が UTR）
          </li>
        </ul>

        {result.geneError && (
          <p className="hint warn">
            遺伝子の情報を取得できなかったため、遺伝子は表示していません。{result.geneError}
            「入力条件を変更する」を開いて、もう一度実行すると再取得します。
          </p>
        )}

        <ExportButtons render={exportMap} fileName={`${stem}.png`} />

        <p className="hint">
          <a
            href={ucscBrowserUrl(assembly, region.chrom, win.lo + 1, win.hi)}
            target="_blank"
            rel="noopener noreferrer"
          >
            UCSC Genome Browser でこの範囲を開く ↗
          </a>
          　遺伝子は RefSeq Select（MANE Select を含む代表転写産物）のある遺伝子を表示しています。
        </p>
      </section>

      {result.genes && (
        <section className="panel">
          <div className="panel-head">
            <h3>範囲に重なる遺伝子（{rows.length}）</h3>
            <span className="field-hint">完全に含まれる遺伝子、ブレークポイントで切断される遺伝子の順（それぞれ位置の昇順）</span>
          </div>

          {rows.length === 0 ? (
            <p className="empty">この範囲に重なる遺伝子は見つかりませんでした。</p>
          ) : (
            <>
              <div className="table-scroll gene-scroll">
                <table className="compare-table gene-table">
                  <thead>
                    <tr>
                      <th>遺伝子</th>
                      <th>参照配列</th>
                      <th>位置</th>
                      <th>鎖</th>
                      <th>種類</th>
                      <th>CNV との関係</th>
                      <th>重なるエクソン</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((h) => (
                      <tr key={h.gene.accession}>
                        <td className="strong">
                          <a
                            href={ucscBrowserUrl(
                              assembly,
                              h.gene.chrom,
                              h.gene.txStart + 1,
                              h.gene.txEnd,
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="UCSC Genome Browser で開く"
                          >
                            {h.gene.gene || h.gene.accession}
                          </a>
                        </td>
                        <td className="mono small">{h.gene.accession}</td>
                        <td className="mono small">
                          {formatRange(h.gene.chrom, h.gene.txStart, h.gene.txEnd)}
                        </td>
                        <td>{h.gene.strand === '+' ? '＋' : '－'}</td>
                        <td>{h.coding ? 'タンパク質コード' : '非コード'}</td>
                        <td>
                          <span className={`rel rel-${h.relation}`}>{RELATION_LABEL[h.relation]}</span>
                        </td>
                        <td className="small">{exonText(h)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="downloads">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => downloadText(genesToTsv(rows), `${stem}_genes.tsv`, 'text/tab-separated-values')}
                >
                  遺伝子リストを TSV で保存
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
