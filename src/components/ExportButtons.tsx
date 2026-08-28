import { useState } from 'react';
import { copyCanvasToClipboard, downloadCanvas } from '../lib/exportImage';

interface Props {
  /** 押されたときに描画を実行する（重い処理を必要になるまで遅延させる） */
  render: () => HTMLCanvasElement;
  fileName: string;
}

type State = 'idle' | 'saved' | 'copied' | 'error';

export function ExportButtons({ render, fileName }: Props) {
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const act = async (kind: 'download' | 'copy') => {
    try {
      const canvas = render();
      if (kind === 'download') {
        await downloadCanvas(canvas, fileName);
        setState('saved');
      } else {
        await copyCanvasToClipboard(canvas);
        setState('copied');
      }
      setMessage(null);
      setTimeout(() => setState('idle'), 2000);
    } catch (e) {
      setState('error');
      setMessage((e as Error).message);
    }
  };

  return (
    <div className="downloads">
      <button type="button" className="ghost" onClick={() => act('download')}>
        {state === 'saved' ? '保存しました' : 'PNG 画像を保存'}
      </button>
      <button type="button" className="ghost" onClick={() => act('copy')}>
        {state === 'copied' ? 'コピーしました' : '画像をクリップボードにコピー'}
      </button>
      {state === 'error' && message && <span className="export-error">{message}</span>}
    </div>
  );
}
