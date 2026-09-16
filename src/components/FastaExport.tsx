import { useMemo, useState } from 'react';
import type { AnalysisRef } from '../lib/compare';
import { downloadText } from '../lib/download';
import {
  buildFasta,
  fastaFileName,
  FASTA_KINDS,
  FASTA_KIND_LABEL,
  type FastaKind,
} from '../lib/fasta';

interface Props {
  refs: AnalysisRef[];
}

/** プレビューに出す行数（長い配列で画面を埋めないよう先頭だけ見せる） */
const PREVIEW_LINES = 12;

export function FastaExport({ refs }: Props) {
  const [kinds, setKinds] = useState<FastaKind[]>(['protein', 'cds']);
  const [includeReference, setIncludeReference] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 選択順ではなく protein → cds → transcript の順で並べる
  const ordered = useMemo(() => FASTA_KINDS.filter((k) => kinds.includes(k)), [kinds]);
  const result = useMemo(
    () => buildFasta(refs, { kinds: ordered, includeReference }),
    [refs, ordered, includeReference],
  );

  const toggle = (kind: FastaKind) => {
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
    setDone(null);
  };

  const flash = (key: string) => {
    setDone(key);
    setError(null);
    setTimeout(() => setDone(null), 2000);
  };

  const save = () => {
    try {
      downloadText(result.text, fastaFileName(refs, ordered));
      flash('save');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.text);
      flash('copy');
    } catch {
      setError('クリップボードにコピーできませんでした。');
    }
  };

  const preview = result.text.split('\n').slice(0, PREVIEW_LINES);
  const truncated = result.text.split('\n').length > PREVIEW_LINES;

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>FASTA で書き出す</h3>
        <span className="field-hint">
          参照配列と{refs.length > 1 ? ` ${refs.length} 件の` : ''}
          バリアントの配列を 1 つのファイルにまとめます
        </span>
      </div>

      <div className="fasta-controls">
        <div className="controls">
          {FASTA_KINDS.map((kind) => (
            <label className="checkbox" key={kind}>
              <input
                type="checkbox"
                checked={kinds.includes(kind)}
                onChange={() => toggle(kind)}
              />
              {FASTA_KIND_LABEL[kind]}
            </label>
          ))}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeReference}
            onChange={(e) => {
              setIncludeReference(e.target.checked);
              setDone(null);
            }}
          />
          参照配列を含める
        </label>
      </div>

      {result.count === 0 ? (
        <p className="empty">書き出す配列の種類を 1 つ以上選んでください。</p>
      ) : (
        <pre className="fasta-preview">
          {preview.join('\n')}
          {truncated ? '\n…' : ''}
        </pre>
      )}

      {result.skipped.length > 0 && (
        <p className="hint warn">{result.skipped.join('、')}</p>
      )}

      <p className="hint">
        ヘッダには <code>V1|NM_…:c.…|protein</code> の形式でタグ・参照配列・配列の種類を記載します
        （{result.count} レコード）。
      </p>

      <div className="downloads">
        <button type="button" className="ghost" onClick={save} disabled={result.count === 0}>
          {done === 'save' ? '保存しました' : 'FASTA ファイルを保存'}
        </button>
        <button type="button" className="ghost" onClick={copy} disabled={result.count === 0}>
          {done === 'copy' ? 'コピーしました' : 'FASTA をコピー'}
        </button>
        {error && <span className="export-error">{error}</span>}
      </div>
    </section>
  );
}
