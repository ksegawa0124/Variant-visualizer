import { useState } from 'react';
import { parseBulkVariants } from '../lib/bulkinput';
import { MAX_ENTRIES, newEntry, type FormValues, type VariantEntry } from '../lib/entries';
import { variantColor, variantTag } from '../lib/palette';
import type { Assembly } from '../lib/ncbi';

interface Props {
  value: FormValues;
  onChange: (value: FormValues) => void;
  onSubmit: () => void;
  busy: boolean;
}

interface ExampleSet {
  label: string;
  note: string;
  variants: Array<{ gene: string; variant: string }>;
}

const EXAMPLES: ExampleSet[] = [
  {
    label: 'BRCA1 コドン 61 の 3 置換',
    note: '同じコドンに起きる置換を重ねて比較',
    variants: [
      { gene: 'BRCA1', variant: 'c.181T>G' },
      { gene: 'BRCA1', variant: 'c.181T>A' },
      { gene: 'BRCA1', variant: 'c.182G>A' },
    ],
  },
  {
    label: 'BRCA1 代表的な 3 変異',
    note: '離れた位置の変異を表で比較（185delAG / C61G / 5382insC）',
    variants: [
      { gene: 'BRCA1', variant: 'c.68_69del' },
      { gene: 'BRCA1', variant: 'c.181T>G' },
      { gene: 'BRCA1', variant: 'c.5266dup' },
    ],
  },
  {
    label: 'CFTR c.1521_1523del',
    note: 'インフレーム欠失（F508del）',
    variants: [{ gene: 'CFTR', variant: 'c.1521_1523del' }],
  },
  {
    label: 'SCN4A c.2111C>T',
    note: 'ミスセンス（T704M）',
    variants: [{ gene: 'SCN4A', variant: 'c.2111C>T' }],
  },
  {
    label: 'TSC2 c.5238_5255del',
    note: 'インフレーム欠失',
    variants: [{ gene: 'TSC2', variant: 'c.5238_5255del' }],
  },
  {
    label: 'DMD c.4918_4919dup',
    note: '重複によるフレームシフト',
    variants: [{ gene: 'DMD', variant: 'c.4918_4919dup' }],
  },
];

export function VariantForm({ value, onChange, onSubmit, busy }: Props) {
  const [showExamples, setShowExamples] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const entries = value.entries;

  const setEntry = (id: string, key: keyof VariantEntry, v: string) =>
    onChange({
      ...value,
      entries: entries.map((e) => (e.id === id ? { ...e, [key]: v } : e)),
    });

  const addEntry = () => {
    // 直前の行から遺伝子と参照配列を引き継ぐ（同じ遺伝子を並べることが多いため）
    const last = entries[entries.length - 1];
    onChange({
      ...value,
      entries: [...entries, newEntry({ gene: last?.gene ?? '', accession: last?.accession ?? '' })],
    });
  };

  const removeEntry = (id: string) =>
    onChange({ ...value, entries: entries.filter((e) => e.id !== id) });

  const applyBulk = () => {
    const parsed = parseBulkVariants(bulkText);
    if (parsed.length === 0) return;
    onChange({
      ...value,
      entries: parsed.slice(0, MAX_ENTRIES).map((p) => newEntry(p)),
    });
    setBulkOpen(false);
    setBulkText('');
  };

  const filled = entries.filter((e) => e.gene.trim() !== '' && e.variant.trim() !== '');
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
          <span className="field-hint">未指定なら GRCh38/hg38・全バリアント共通</span>
        </span>
        <select
          value={value.assembly}
          onChange={(e) => onChange({ ...value, assembly: e.target.value as Assembly })}
          disabled={busy}
        >
          <option value="GRCh38">GRCh38 / hg38</option>
          <option value="GRCh37">GRCh37 / hg19</option>
        </select>
      </label>

      <div className="entry-list">
        <div className="entry-head">
          <span className="entry-col-tag" />
          <span>
            遺伝子 <span className="required">必須</span>
          </span>
          <span>
            バリアントの詳細 <span className="required">必須</span>
            <span className="field-hint">HGVS.c 記法</span>
          </span>
          <span>
            参照配列
            <span className="field-hint">未指定なら MANE Select</span>
          </span>
          <span className="entry-col-remove" />
        </div>

        {entries.map((entry, i) => (
          <div className="entry-row" key={entry.id}>
            <span className="entry-tag" style={{ background: variantColor(i) }}>
              {variantTag(i)}
            </span>
            <input
              type="text"
              aria-label={`${variantTag(i)} の遺伝子`}
              value={entry.gene}
              onChange={(e) => setEntry(entry.id, 'gene', e.target.value)}
              placeholder="BRCA1"
              spellCheck={false}
              autoCapitalize="characters"
              disabled={busy}
            />
            <input
              type="text"
              aria-label={`${variantTag(i)} のバリアント`}
              value={entry.variant}
              onChange={(e) => setEntry(entry.id, 'variant', e.target.value)}
              placeholder="c.68_69del"
              spellCheck={false}
              disabled={busy}
            />
            <input
              type="text"
              aria-label={`${variantTag(i)} の参照配列`}
              value={entry.accession}
              onChange={(e) => setEntry(entry.id, 'accession', e.target.value)}
              placeholder="NM_007294.4"
              spellCheck={false}
              disabled={busy}
            />
            <button
              type="button"
              className="entry-remove"
              onClick={() => removeEntry(entry.id)}
              disabled={busy || entries.length === 1}
              title="この行を削除"
              aria-label={`${variantTag(i)} を削除`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={!canSubmit}>
          {busy
            ? '解析中…'
            : filled.length > 1
              ? `${filled.length} 件を比較する`
              : '参照配列と比較する'}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={addEntry}
          disabled={busy || entries.length >= MAX_ENTRIES}
          title={entries.length >= MAX_ENTRIES ? `一度に比較できるのは ${MAX_ENTRIES} 件までです` : undefined}
        >
          ＋ バリアントを追加
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

      {bulkOpen && (
        <div className="bulk">
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={5}
            spellCheck={false}
            disabled={busy}
            placeholder={'BRCA1 c.68_69del\nBRCA1 c.181T>G\nNM_007294.4(BRCA1):c.5266dup'}
          />
          <div className="bulk-actions">
            <button type="button" className="ghost" onClick={applyBulk} disabled={busy}>
              入力欄に反映
            </button>
            <span className="field-hint">
              1 行 1 バリアント。遺伝子名を省くと直前の行から引き継ぎます（最大 {MAX_ENTRIES} 件）。
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
                  onChange({
                    ...value,
                    entries: ex.variants.map((v) => newEntry(v)),
                  });
                  setShowExamples(false);
                }}
              >
                <code>{ex.label}</code>
                <span>{ex.note}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="form-note">
        対応する変異型: 置換 (c.76A&gt;T) / 欠失 (c.76del, c.76_78del) / 重複 (c.76dup) / 挿入
        (c.76_77insG) / 欠失挿入 (c.76_78delinsAC) / 逆位 (c.76_78inv)
      </p>
    </form>
  );
}
