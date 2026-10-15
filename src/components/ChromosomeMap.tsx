import { useEffect, useMemo, useState } from 'react';
import type { EntryResult } from '../lib/compare';
import {
  cytobandLabel,
  formatRange,
  formatSpan,
  PRINT_THEME,
  renderChromosomeMap,
  SCREEN_THEME,
  type MapModel,
  type MapVariant,
} from '../lib/chrommap';
import type { Assembly } from '../lib/ncbi';
import { variantColor, variantTag } from '../lib/palette';
import {
  fetchChromosome,
  fetchGeneLayout,
  ucscBrowserUrl,
  type Chromosome,
  type GeneLayout,
} from '../lib/ucsc';
import { svgToCanvas } from '../lib/svgRaster';
import { ExportButtons } from './ExportButtons';

interface Props {
  entries: EntryResult[];
  assembly: Assembly;
  assemblyLabel: string;
  activeId: string | null;
  /** 複数バリアントのときだけ V1, V2… のタグを付ける */
  showTags: boolean;
  onSelect: (id: string) => void;
}

interface Loaded {
  chromosome: Chromosome | null;
  layout: GeneLayout | null;
  error: string | null;
}

/** UCSC へのリンクで、変異の前後に足す余白（bp） */
const LINK_PAD = 100;

export function ChromosomeMap({
  entries,
  assembly,
  assemblyLabel,
  activeId,
  showTags,
  onSelect,
}: Props) {
  const [store, setStore] = useState<Record<string, Loaded>>({});

  const active = entries.find((e) => e.id === activeId) ?? null;
  const analysis = active?.analysis ?? null;
  const genomic = active?.genomic ?? null;
  const chrom = genomic?.chromosome ? `chr${genomic.chromosome}` : null;
  const accession = analysis?.transcript.accession ?? null;
  const position = genomic?.start ?? null;
  const key = chrom && accession ? `${assembly}:${chrom}:${accession}` : null;
  const loaded = key ? store[key] : undefined;

  // 取得済みのキーは再取得しない。行を切り替えても表示がちらつかない
  useEffect(() => {
    if (!key || !chrom || !accession || position === null || store[key]) return;
    let alive = true;
    Promise.allSettled([
      fetchChromosome(assembly, chrom),
      fetchGeneLayout(assembly, chrom, position, accession),
    ]).then(([c, g]) => {
      if (!alive) return;
      setStore((prev) => ({
        ...prev,
        [key]: {
          chromosome: c.status === 'fulfilled' ? c.value : null,
          layout: g.status === 'fulfilled' ? g.value : null,
          error: c.status === 'rejected' ? (c.reason as Error).message : null,
        },
      }));
    });
    return () => {
      alive = false;
    };
  }, [key, chrom, accession, position, assembly, store]);

  // この染色体上にあるすべてのバリアント
  const variants = useMemo<MapVariant[]>(
    () =>
      entries.flatMap((e) =>
        e.analysis && e.genomic?.chromosome && `chr${e.genomic.chromosome}` === chrom
          ? [
              {
                id: e.id,
                order: e.index,
                tag: showTags ? variantTag(e.index) : null,
                label: e.analysis.parsed.normalized,
                color: variantColor(e.index),
                accession: e.analysis.transcript.accession,
                start: e.genomic.start - 1,
                end: e.genomic.end,
              },
            ]
          : [],
      ),
    [entries, chrom, showTags],
  );

  // 解析できたのに、この図には載せられないバリアント（座標なし・別の染色体）
  const notPlotted = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.analysis &&
          !e.genomicPending &&
          !variants.some((v) => v.id === e.id),
      ),
    [entries, variants],
  );

  const model = useMemo<MapModel | null>(
    () =>
      loaded?.chromosome && active && variants.length > 0
        ? {
            chromosome: loaded.chromosome,
            layout: loaded.layout,
            variants,
            activeId: active.id,
          }
        : null,
    [loaded, active, variants],
  );

  const screen = useMemo(
    () => (model ? renderChromosomeMap(model, { theme: SCREEN_THEME }) : null),
    [model],
  );

  if (!analysis) return null;

  const wrap = (children: React.ReactNode) => (
    <section className="panel">
      <h3>染色体上の位置</h3>
      {children}
    </section>
  );

  if (active?.genomicPending) {
    return wrap(
      <p className="empty">
        <span className="spinner" aria-hidden="true" /> ゲノム座標を取得しています…
      </p>,
    );
  }
  if (!genomic || !chrom || !accession) {
    return wrap(
      <p className="empty">
        ゲノム座標を取得できなかったため、染色体上の位置は表示できません。
      </p>,
    );
  }
  if (!loaded) {
    return wrap(
      <p className="empty">
        <span className="spinner" aria-hidden="true" /> UCSC Genome Browser
        から染色体情報を取得しています…
      </p>,
    );
  }
  if (!model || !screen) {
    // 失敗は記憶に残さず、ボタンで取得し直せるようにする
    const retry = () =>
      setStore((prev) => {
        const next = { ...prev };
        delete next[key!];
        return next;
      });
    return wrap(
      <>
        <p className="empty">{loaded.error ?? '染色体情報を取得できませんでした。'}</p>
        <div className="downloads">
          <button type="button" className="ghost" onClick={retry}>
            再試行
          </button>
        </div>
      </>,
    );
  }

  const { chromosome, layout } = model;
  const variant = variants.find((v) => v.id === active!.id)!;
  const geneRange = layout ? formatRange(chrom, layout.txStart, layout.txEnd) : null;
  const band = cytobandLabel(
    chromosome,
    layout ? layout.txStart : variant.start,
    layout ? layout.txEnd : variant.end,
  );

  const exportMap = () => {
    const names = variants.slice(0, 4).map((v) => (v.tag ? `${v.tag} ${v.label}` : v.label));
    const more = variants.length > 4 ? ` ほか ${variants.length - 4} 件` : '';
    const out = renderChromosomeMap(model, {
      theme: PRINT_THEME,
      legend: true,
      header: {
        title: `染色体上の位置${layout?.gene ? ` — ${layout.gene}` : ''}`,
        subtitle: [
          assemblyLabel,
          geneRange ?? formatRange(chrom, variant.start, variant.end),
          band,
          names.join('、') + more,
        ].join('　|　'),
      },
    });
    return svgToCanvas(out.svg, out.width, out.height, 2);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>染色体上の位置</h3>
        <span className="field-hint">
          染色体 → 遺伝子 → 変異の周辺の順に拡大しています。印をクリックするとそのバリアントに切り替わります
        </span>
      </div>

      <p className="chrom-summary">
        {layout ? (
          <>
            <strong>{layout.gene || accession}</strong> は染色体 <strong>{band}</strong> の
            {layout.strand === '+' ? 'プラス鎖（＋）' : 'マイナス鎖（－）'}にあります。
          </>
        ) : (
          <>
            バリアントは染色体 <strong>{band}</strong> にあります。
          </>
        )}{' '}
        <span className="mono">{formatRange(chrom, variant.start, variant.end)}</span>
        {layout && (
          <span className="muted">（遺伝子全体 {formatSpan(layout.txEnd - layout.txStart)}）</span>
        )}
      </p>

      {/* 図は自前の SVG 文字列。内容は取得した座標と、エスケープ済みの名前だけ */}
      <div
        className="chrom-map"
        role="presentation"
        onClick={(e) => {
          const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
          if (id) onSelect(id);
        }}
        dangerouslySetInnerHTML={{ __html: screen.svg }}
      />

      <ul className="legend">
        <li>
          <span className="swatch map-legend-cds" /> コード領域
        </li>
        <li>
          <span className="swatch map-legend-utr" /> UTR（非翻訳領域）
        </li>
        <li>
          <span className="map-legend-intron" aria-hidden="true">
            ›››
          </span>{' '}
          イントロン（矢印は転写方向）
        </li>
        <li>
          <span className="map-legend-var" aria-hidden="true">
            ▼
          </span>{' '}
          バリアント
        </li>
      </ul>

      {notPlotted.length > 0 && (
        <p className="hint warn">
          {notPlotted
            .map((e) => `${showTags ? `${variantTag(e.index)} ` : ''}${e.analysis!.parsed.normalized}`)
            .join('、')}{' '}
          は
          {notPlotted.some((e) => !e.genomic)
            ? 'ゲノム座標を取得できなかった（イントロン内の変異など）か、別の染色体にあるため'
            : '別の染色体にあるため'}
          、この図には含めていません。
        </p>
      )}

      {!layout && (
        <p className="hint warn">
          UCSC Genome Browser から {accession} のエクソン構造を取得できなかったため、
          染色体上のバリアント位置だけを表示しています。
        </p>
      )}

      <ExportButtons
        render={exportMap}
        fileName={`${layout?.gene || 'variant'}_${chrom}_${assembly}_map.png`}
      />

      <p className="hint">
        <a
          href={ucscBrowserUrl(
            assembly,
            chrom,
            Math.max(1, variant.start + 1 - LINK_PAD),
            variant.end + LINK_PAD,
          )}
          target="_blank"
          rel="noopener noreferrer"
        >
          UCSC Genome Browser でこの変異の周辺を開く ↗
        </a>
        {layout && (
          <>
            {' ／ '}
            <a
              href={ucscBrowserUrl(assembly, chrom, layout.txStart + 1, layout.txEnd)}
              target="_blank"
              rel="noopener noreferrer"
            >
              遺伝子全体を開く ↗
            </a>
          </>
        )}
        　図のデータは UCSC Genome Browser の RefSeq 遺伝子とバンド情報です。
      </p>
    </section>
  );
}
