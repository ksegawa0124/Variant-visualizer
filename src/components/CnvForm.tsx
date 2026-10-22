import { useState } from 'react';
import { CNV_INFO, parseCnvPosition, type CnvFormValues, type CnvType } from '../lib/cnv';
import { formatSpan } from '../lib/chrommap';
import type { Assembly } from '../lib/ncbi';

interface Props {
  value: CnvFormValues;
  onChange: (value: CnvFormValues) => void;
  assembly: Assembly;
  onAssemblyChange: (assembly: Assembly) => void;
  onSubmit: () => void;
  busy: boolean;
}

interface Example {
  label: string;
  note: string;
  position: string;
  type: CnvType;
  assembly: Assembly;
}

// 座標は GRCh38。臨床的に知られた領域の概算で、正確なブレークポイントではない
const EXAMPLES: Example[] = [
  {
    label: 'BRCA1 全体の欠失',
    note: '1 遺伝子ぶんの Loss（約 81 kb）',
    position: 'chr17:43,044,295-43,125,364',
    type: 'loss',
    assembly: 'GRCh38',
  },
  {
    label: '22q11.2 欠失症候群の領域',
    note: 'Loss（約 2.5 Mb）。TBX1 などを含む',
    position: 'chr22:18,924,000-21,465,000',
    type: 'loss',
    assembly: 'GRCh38',
  },
  {
    label: '16p11.2 領域',
    note: 'Gain（約 0.6 Mb）。TBX6・KCTD13 などを含む',
    position: 'chr16:29,600,000-30,200,000',
    type: 'gain',
    assembly: 'GRCh38',
  },
  {
    label: 'PMP22 を含む領域の重複',
    note: 'Gain（約 1.4 Mb）。CMT1A 領域の概算',
    position: 'chr17:15,000,000-16,400,000',
    type: 'gain',
    assembly: 'GRCh38',
  },
];

const TYPES: CnvType[] = ['loss', 'gain'];

export function CnvForm({ value, onChange, assembly, onAssemblyChange, onSubmit, busy }: Props) {
  const [showExamples, setShowExamples] = useState(false);

  // 入力中に、どう読み取られたかをその場で見せる
  let preview: { ok: true; text: string } | { ok: false; text: string } | null = null;
  if (value.position.trim() !== '') {
    try {
      const p = parseCnvPosition(value.position);
      preview = {
        ok: true,
        text: `${p.chrom} の ${p.start.toLocaleString('en-US')} 〜 ${p.end.toLocaleString('en-US')}（${formatSpan(p.end - p.start + 1)}）`,
      };
    } catch (e) {
      preview = { ok: false, text: (e as Error).message };
    }
  }
  const canSubmit = value.position.trim() !== '' && !busy;

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
          <span className="field-hint">入力する座標が属するアセンブリを選びます</span>
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

      <div className="cnv-fields">
        <label className="field">
          <span className="field-label">
            染色体位置 <span className="required">必須</span>
            <span className="field-hint">開始・終了とも 1 始まり、両端を含む（UCSC と同じ）</span>
          </span>
          <input
            type="text"
            value={value.position}
            onChange={(e) => onChange({ ...value, position: e.target.value })}
            placeholder="chr17:43,044,295-43,125,364"
            spellCheck={false}
            disabled={busy}
            aria-describedby="cnv-preview"
          />
        </label>

        <div className="field">
          <span className="field-label" id="cnv-type-label">
            種類 <span className="required">必須</span>
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="cnv-type-label">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={value.type === t}
                className={`seg-btn seg-${t}${value.type === t ? ' on' : ''}`}
                onClick={() => onChange({ ...value, type: t })}
                disabled={busy}
                style={{ ['--seg-color' as string]: CNV_INFO[t].color }}
              >
                <strong>{CNV_INFO[t].label}</strong>
                <span>{t === 'loss' ? '減少・欠失' : '増加・重複'}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p id="cnv-preview" className={`cnv-preview${preview && !preview.ok ? ' bad' : ''}`}>
        {preview ? (preview.ok ? `読み取り結果: ${preview.text}` : preview.text) : ' '}
      </p>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={!canSubmit}>
          {busy ? '取得中…' : 'CNV を図示する'}
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
            <li key={ex.label}>
              <button
                type="button"
                onClick={() => {
                  onChange({ position: ex.position, type: ex.type });
                  onAssemblyChange(ex.assembly);
                  setShowExamples(false);
                }}
              >
                <code>{ex.label}</code>
                <span>
                  {ex.note}　<span className="mono">{ex.position}</span>
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
