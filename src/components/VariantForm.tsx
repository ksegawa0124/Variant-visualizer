import { useState } from 'react';
import type { Assembly } from '../lib/ncbi';

export interface FormValues {
  assembly: Assembly;
  accession: string;
  gene: string;
  variant: string;
}

interface Props {
  value: FormValues;
  onChange: (value: FormValues) => void;
  onSubmit: () => void;
  busy: boolean;
}

interface Example extends FormValues {
  note: string;
}

const EXAMPLES: Example[] = [
  { assembly: 'GRCh38', accession: '', gene: 'BRCA1', variant: 'c.68_69del', note: 'フレームシフト（185delAG）' },
  { assembly: 'GRCh38', accession: '', gene: 'BRCA1', variant: 'c.181T>G', note: 'ミスセンス（C61G）' },
  { assembly: 'GRCh38', accession: '', gene: 'TSC2', variant: 'c.5238_5255del', note: 'インフレーム欠失' },
  { assembly: 'GRCh38', accession: '', gene: 'SCN4A', variant: 'c.2111C>T', note: 'ミスセンス（T704M）' },
  { assembly: 'GRCh38', accession: '', gene: 'CFTR', variant: 'c.1521_1523del', note: 'インフレーム欠失（F508del）' },
  { assembly: 'GRCh38', accession: '', gene: 'DMD', variant: 'c.4918_4919dup', note: '重複によるフレームシフト' },
];

export function VariantForm({ value, onChange, onSubmit, busy }: Props) {
  const [showExamples, setShowExamples] = useState(false);
  const set = <K extends keyof FormValues>(key: K, v: FormValues[K]) =>
    onChange({ ...value, [key]: v });

  const canSubmit = value.gene.trim() !== '' && value.variant.trim() !== '' && !busy;

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit();
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span className="field-label">
            リファレンスゲノム
            <span className="field-hint">未指定なら GRCh38/hg38</span>
          </span>
          <select
            value={value.assembly}
            onChange={(e) => set('assembly', e.target.value as Assembly)}
            disabled={busy}
          >
            <option value="GRCh38">GRCh38 / hg38</option>
            <option value="GRCh37">GRCh37 / hg19</option>
          </select>
        </label>

        <label className="field">
          <span className="field-label">
            参照配列
            <span className="field-hint">未指定なら MANE Select を自動選択</span>
          </span>
          <input
            type="text"
            value={value.accession}
            onChange={(e) => set('accession', e.target.value)}
            placeholder="NM_007294.4"
            spellCheck={false}
            disabled={busy}
          />
        </label>

        <label className="field">
          <span className="field-label">
            遺伝子 <span className="required">必須</span>
          </span>
          <input
            type="text"
            value={value.gene}
            onChange={(e) => set('gene', e.target.value)}
            placeholder="BRCA1"
            spellCheck={false}
            autoCapitalize="characters"
            required
            disabled={busy}
          />
        </label>

        <label className="field">
          <span className="field-label">
            バリアントの詳細 <span className="required">必須</span>
            <span className="field-hint">HGVS.c 記法</span>
          </span>
          <input
            type="text"
            value={value.variant}
            onChange={(e) => set('variant', e.target.value)}
            placeholder="c.68_69del"
            spellCheck={false}
            required
            disabled={busy}
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={!canSubmit}>
          {busy ? '解析中…' : '参照配列と比較する'}
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

      {showExamples && (
        <ul className="examples">
          {EXAMPLES.map((ex) => (
            <li key={`${ex.gene}${ex.variant}`}>
              <button
                type="button"
                onClick={() => {
                  onChange({
                    assembly: ex.assembly,
                    accession: ex.accession,
                    gene: ex.gene,
                    variant: ex.variant,
                  });
                  setShowExamples(false);
                }}
              >
                <code>
                  {ex.gene} {ex.variant}
                </code>
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
