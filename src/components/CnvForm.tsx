import { useState } from 'react';
import {
  CNV_INFO,
  MAX_CNVS,
  newCnvEntry,
  parseBulkCnvs,
  parseCnvPosition,
  type CnvEntry,
  type CnvType,
} from '../lib/cnv';
import { formatSpan } from '../lib/chrommap';
import type { Assembly } from '../lib/ncbi';

interface Props {
  value: CnvEntry[];
  onChange: (value: CnvEntry[]) => void;
  assembly: Assembly;
  onAssemblyChange: (assembly: Assembly) => void;
  onSubmit: () => void;
  busy: boolean;
}

interface ExampleSet {
  label: string;
  note: string;
  assembly: Assembly;
  cnvs: Array<{ position: string; type: CnvType }>;
}

// 座標は GRCh38。臨床的に知られた領域の概算で、正確なブレークポイントではない
const EXAMPLES: ExampleSet[] = [
  {
    label: '3 つの CNV を並べて図示',
    note: '22q11.2 の Loss・16p11.2 の Gain・BRCA1 全体の Loss',
    assembly: 'GRCh38',
    cnvs: [
      { position: 'chr22:18,924,000-21,465,000', type: 'loss' },
      { position: 'chr16:29,600,000-30,200,000', type: 'gain' },
      { position: 'chr17:43,044,295-43,125,364', type: 'loss' },
    ],
  },
  {
    label: 'BRCA1 全体の欠失',
    note: '1 遺伝子ぶんの Loss（約 81 kb）',
    assembly: 'GRCh38',
    cnvs: [{ position: 'chr17:43,044,295-43,125,364', type: 'loss' }],
  },
  {
    label: '22q11.2 欠失症候群の領域',
    note: 'Loss（約 2.5 Mb）。TBX1 などを含む',
    assembly: 'GRCh38',
    cnvs: [{ position: 'chr22:18,924,000-21,465,000', type: 'loss' }],
  },
  {
    label: '16p11.2 領域',
    note: 'Gain（約 0.6 Mb）。TBX6・KCTD13 などを含む',
    assembly: 'GRCh38',
    cnvs: [{ position: 'chr16:29,600,000-30,200,000', type: 'gain' }],
  },
  {
    label: 'PMP22 を含む領域の重複',
    note: 'Gain（約 1.4 Mb）。CMT1A 領域の概算',
    assembly: 'GRCh38',
    cnvs: [{ position: 'chr17:15,000,000-16,400,000', type: 'gain' }],
  },
];

const TYPES: CnvType[] = ['loss', 'gain'];

/** 入力中に、どう読み取られたかをその場で見せる */
function previewOf(position: string): { ok: boolean; text: string } | null {
  if (position.trim() === '') return null;
  try {
    const p = parseCnvPosition(position);
    return {
      ok: true,
      text: `${p.chrom} の ${p.start.toLocaleString('en-US')} 〜 ${p.end.toLocaleString('en-US')}（${formatSpan(p.end - p.start + 1)}）`,
    };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

export function CnvForm({ value, onChange, assembly, onAssemblyChange, onSubmit, busy }: Props) {
  const [showExamples, setShowExamples] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkNote, setBulkNote] = useState<string | null>(null);

  const setEntry = (id: string, patch: Partial<CnvEntry>) =>
    onChange(value.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const addEntry = () => {
    // 直前の行の種類を引き継ぐ（同じ種類を続けて入力することが多いため）
    const last = value[value.length - 1];
    onChange([...value, newCnvEntry({ type: last?.type ?? 'loss' })]);
  };

  const removeEntry = (id: string) => onChange(value.filter((e) => e.id !== id));

  const applyBulk = () => {
    const { entries, skipped } = parseBulkCnvs(bulkText);
    const notes: string[] = [];
    if (entries.length > MAX_CNVS) {
      notes.push(`最初の ${MAX_CNVS} 件だけを反映しました（一度に図示できるのは ${MAX_CNVS} 件までです）。`);
    }
    if (skipped.length > 0) {
      notes.push(
        `種類（Loss / Gain）が読み取れない行は反映していません: ${skipped.map((l) => `「${l}」`).join('')}`,
      );
    }
    setBulkNote(notes.length > 0 ? notes.join(' ') : null);
    if (entries.length === 0) return;
    onChange(entries.slice(0, MAX_CNVS).map((c) => newCnvEntry(c)));
    setBulkOpen(false);
    setBulkText('');
  };

  const filled = value.filter((e) => e.position.trim() !== '');
  const canSubmit = filled.length > 0 && !busy;

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <label className="field assembly-field">
        <span className="field-label">
          リファレンスゲノム
          <span className="field-hint">入力する座標が属するアセンブリ・全 CNV 共通</span>
        </span>
        <select
          value={assembly}
          onChange={(e) => onAssemblyChange(e.target.value as Assembly)}
          disabled={busy}
        >
          <option value="GRCh38">GRCh38 / hg38</option>
          <option value="GRCh37">GRCh37 / hg19</option>
        </select>
      </label>

      <div className="entry-list cnv-list">
        <div className="cnv-head">
          <span className="entry-col-tag" />
          <span>
            染色体位置 <span className="required">必須</span>
            <span className="field-hint">開始・終了とも 1 始まり、両端を含む（UCSC と同じ）</span>
          </span>
          <span>
            種類 <span className="required">必須</span>
          </span>
          <span className="entry-col-remove" />
        </div>

        {value.map((entry, i) => {
          const preview = previewOf(entry.position);
          const info = CNV_INFO[entry.type];
          return (
            <div className="cnv-item" key={entry.id}>
              <div className="cnv-row">
                <span className="entry-tag" style={{ background: info.color }}>
                  #{i + 1}
                </span>
                <input
                  type="text"
                  aria-label={`CNV ${i + 1} の染色体位置`}
                  aria-describedby={`cnv-preview-${entry.id}`}
                  value={entry.position}
                  onChange={(e) => setEntry(entry.id, { position: e.target.value })}
                  placeholder="chr17:43,044,295-43,125,364"
                  spellCheck={false}
                  disabled={busy}
                />
                <div className="seg" role="radiogroup" aria-label={`CNV ${i + 1} の種類`}>
                  {TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={entry.type === t}
                      className={`seg-btn seg-${t}${entry.type === t ? ' on' : ''}`}
                      onClick={() => setEntry(entry.id, { type: t })}
                      disabled={busy}
                      aria-label={`${CNV_INFO[t].label}（${t === 'loss' ? 'コピー数の減少・欠失' : 'コピー数の増加・重複'}）`}
                      title={t === 'loss' ? 'コピー数の減少・欠失' : 'コピー数の増加・重複'}
                      style={{ ['--seg-color' as string]: CNV_INFO[t].color }}
                    >
                      <strong>{CNV_INFO[t].label}</strong>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="entry-remove"
                  onClick={() => removeEntry(entry.id)}
                  disabled={busy || value.length === 1}
                  title="この行を削除"
                  aria-label={`CNV ${i + 1} を削除`}
                >
                  ×
                </button>
              </div>
              <p
                id={`cnv-preview-${entry.id}`}
                className={`cnv-preview${preview && !preview.ok ? ' bad' : ''}`}
              >
                {preview ? (preview.ok ? `読み取り結果: ${preview.text}` : preview.text) : ' '}
              </p>
            </div>
          );
        })}
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={!canSubmit}>
          {busy
            ? '取得中…'
            : filled.length > 1
              ? `${filled.length} 件の CNV を図示する`
              : 'CNV を図示する'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={addEntry}
          disabled={busy || value.length >= MAX_CNVS}
          title={value.length >= MAX_CNVS ? `一度に図示できるのは ${MAX_CNVS} 件までです` : undefined}
        >
          ＋ CNV を追加
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setBulkOpen((b) => !b)}
          disabled={busy}
        >
          まとめて入力 {bulkOpen ? '▲' : '▼'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => setShowExamples((s) => !s)}
          disabled={busy}
        >
          入力例 {showExamples ? '▲' : '▼'}
        </button>
      </div>

      {bulkNote && (
        <p className="hint warn" role="status">
          {bulkNote}
        </p>
      )}

      {bulkOpen && (
        <div className="bulk">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            spellCheck={false}
            disabled={busy}
            placeholder={
              'chr22:18,924,000-21,465,000 Loss\nchr16:29,600,000-30,200,000 Gain\n17:43044295-43125364 欠失'
            }
          />
          <div className="bulk-actions">
            <button type="button" className="ghost" onClick={applyBulk} disabled={busy}>
              入力欄に反映
            </button>
            <span className="field-hint">
              1 行 1 CNV。行の中に Loss / Gain（del / dup、欠失 / 重複 も可）を書いてください（最大{' '}
              {MAX_CNVS} 件）。
            </span>
          </div>
        </div>
      )}

      {showExamples && (
        <ul className="examples">
          {EXAMPLES.map((ex) => (
            <li key={ex.label}>
              <button
                type="button"
                onClick={() => {
                  onChange(ex.cnvs.map((c) => newCnvEntry(c)));
                  onAssemblyChange(ex.assembly);
                  setBulkNote(null);
                  setShowExamples(false);
                }}
              >
                <code>{ex.label}</code>
                <span>
                  {ex.note}
                  {ex.cnvs.length === 1 && (
                    <>
                      　<span className="mono">{ex.cnvs[0].position}</span>
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="form-note">
        入力形式: chr17:43044295-43125364 / 17:43,044,295-43,125,364 / chrX 1000000 2000000
      </p>
    </form>
  );
}
