import { useMemo, useState } from 'react';
import type { CalcResult, KeywordRule } from '../lib/parser';

type ApiResponse = {
  total: number;
  autoCount: number;
  manualCount: number;
  preview: CalcResult[];
  results: CalcResult[];
};

const DEFAULT_RULES: KeywordRule[] = [
  { id: '1', label: 'BELDEN 88760', pattern: 'BELDEN\\s*88760', cablePerMeter: 200, plugPerPiece: 300 },
  { id: '2', label: 'MOGAMI 2534', pattern: 'MOGAMI\\s*2534', cablePerMeter: 150, plugPerPiece: 300 },
  { id: '3', label: 'CANARE L-4E6S', pattern: 'CANARE\\s*L-?4E6S', cablePerMeter: 100, plugPerPiece: 250 },
];

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [rules, setRules] = useState<KeywordRule[]>(DEFAULT_RULES);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  const updateRule = (i: number, patch: Partial<KeywordRule>) => {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRule = () => {
    setRules((rs) => [
      ...rs,
      { id: String(Date.now()), label: '', pattern: '', cablePerMeter: 0, plugPerPiece: 0 },
    ]);
  };

  const removeRule = (i: number) => {
    setRules((rs) => rs.filter((_, idx) => idx !== i));
  };

  const onSubmit = async () => {
    if (!file) {
      setError('CSVファイルを選んでください');
      return;
    }
    setError(null);
    setLoading(true);
    setData(null);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('rules', JSON.stringify(rules));
      fd.append('activeOnly', String(activeOnly));
      const res = await fetch('/.netlify/functions/calc', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? '不明なエラー');
      } else {
        setData(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '通信エラー');
    } finally {
      setLoading(false);
    }
  };

  const downloadAuto = () => {
    if (!data) return;
    const lines = ['sku,price'];
    for (const r of data.results) {
      if (r.newPrice !== null) lines.push(`${csvEscape(r.sku)},${r.newPrice}`);
    }
    download('amazon_price_update.csv', lines.join('\n'));
  };

  const downloadManual = () => {
    if (!data) return;
    const lines = ['sku,asin,商品名,現在価格,手動対応理由'];
    for (const r of data.results) {
      if (r.newPrice === null) {
        lines.push(
          `${csvEscape(r.sku)},${csvEscape(r.asin)},${csvEscape(r.productName)},${r.currentPrice},${csvEscape(r.manualReason ?? '')}`
        );
      }
    }
    download('manual_review_list.csv', lines.join('\n'));
  };

  const stats = useMemo(() => {
    if (!data) return null;
    const rate = data.total ? Math.round((data.autoCount / data.total) * 1000) / 10 : 0;
    return { rate };
  }, [data]);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'sans-serif', background: '#fff', color: '#000', minHeight: '100vh' }}>
      <h1>Amazon価格改定ツール（プロトタイプ）</h1>
      <p style={{ color: '#555' }}>
        商品名のキーワード一致で「ケーブル単価×長さ＋プラグ単価×個数」を現在価格に加算します。
      </p>

      <section style={card}>
        <h2>1. CSVを選ぶ</h2>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <label style={{ marginLeft: 16 }}>
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          Activeのみ対象にする
        </label>
        {file && (
          <p style={{ color: '#888', fontSize: 13 }}>
            選択中: {file.name} ({Math.round(file.size / 1024)} KB)
          </p>
        )}
      </section>

      <section style={card}>
        <h2>2. キーワードと加算額を設定</h2>
        <p style={{ color: '#666', fontSize: 13 }}>
          パターンは正規表現で書けます（例: <code>BELDEN\s*88760</code>）。先に書いたルールから順に判定し、最初にマッチしたものが採用されます。
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={th}>表示名</th>
              <th style={th}>正規表現パターン</th>
              <th style={th}>1m単価（円）</th>
              <th style={th}>プラグ単価（円）</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={r.id}>
                <td style={td}>
                  <input
                    style={inp}
                    value={r.label}
                    onChange={(e) => updateRule(i, { label: e.target.value })}
                  />
                </td>
                <td style={td}>
                  <input
                    style={inp}
                    value={r.pattern}
                    onChange={(e) => updateRule(i, { pattern: e.target.value })}
                  />
                </td>
                <td style={td}>
                  <input
                    type="number"
                    style={inp}
                    value={r.cablePerMeter}
                    onChange={(e) => updateRule(i, { cablePerMeter: Number(e.target.value) })}
                  />
                </td>
                <td style={td}>
                  <input
                    type="number"
                    style={inp}
                    value={r.plugPerPiece}
                    onChange={(e) => updateRule(i, { plugPerPiece: Number(e.target.value) })}
                  />
                </td>
                <td style={td}>
                  <button onClick={() => removeRule(i)}>削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={addRule} style={{ marginTop: 8 }}>＋ ルール追加</button>
      </section>

      <section style={card}>
        <h2>3. 実行</h2>
        <button
          onClick={onSubmit}
          disabled={loading}
          style={{
            padding: '10px 24px',
            fontSize: 16,
            background: loading ? '#aaa' : '#0070f3',
            color: '#fff',
            border: 0,
            borderRadius: 4,
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? '計算中...' : '価格改定を実行'}
        </button>
        {error && (
          <p style={{ color: '#c00', marginTop: 12 }}>エラー: {error}</p>
        )}
      </section>

      {data && (
        <section style={card}>
          <h2>4. 結果</h2>
          <p>
            読み込み件数: <b>{data.total.toLocaleString()}</b> 件 ／ 自動改定: <b style={{ color: '#080' }}>{data.autoCount.toLocaleString()}</b> 件 ／
            手動対応: <b style={{ color: '#c80' }}>{data.manualCount.toLocaleString()}</b> 件
            （自動率 {stats?.rate}%）
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <button onClick={downloadAuto}>自動改定CSVをダウンロード</button>
            <button onClick={downloadManual}>手動対応リストCSVをダウンロード</button>
          </div>
          <h3>プレビュー（先頭50件）</h3>
          <div style={{ overflow: 'auto', maxHeight: 500, border: '1px solid #ddd' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f0f0f0', position: 'sticky', top: 0 }}>
                  <th style={th}>SKU</th>
                  <th style={th}>商品名</th>
                  <th style={th}>マッチ</th>
                  <th style={th}>長さ(m)</th>
                  <th style={th}>個数</th>
                  <th style={th}>現価格</th>
                  <th style={th}>新価格</th>
                  <th style={th}>差額</th>
                  <th style={th}>手動理由</th>
                </tr>
              </thead>
              <tbody>
                {data.preview.map((r, i) => (
                  <tr key={i} style={{ background: r.newPrice === null ? '#fff8e1' : 'transparent' }}>
                    <td style={td}>{r.sku}</td>
                    <td style={td} title={r.productName}>
                      {r.productName.slice(0, 40)}
                      {r.productName.length > 40 ? '…' : ''}
                    </td>
                    <td style={td}>{r.matchedRuleLabel ?? '-'}</td>
                    <td style={td}>{r.lengthM ?? '-'}</td>
                    <td style={td}>{r.pieces ?? '-'}</td>
                    <td style={td}>{r.currentPrice.toLocaleString()}</td>
                    <td style={td}>{r.newPrice !== null ? r.newPrice.toLocaleString() : '-'}</td>
                    <td style={td}>{r.diff !== null ? `+${r.diff.toLocaleString()}` : '-'}</td>
                    <td style={td}>{r.manualReason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 16,
  marginTop: 16,
};
const th: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 8px', textAlign: 'left' };
const td: React.CSSProperties = { border: '1px solid #eee', padding: '4px 8px', verticalAlign: 'top' };
const inp: React.CSSProperties = { width: '100%', padding: 6, boxSizing: 'border-box', background: '#fff', color: '#000', border: '1px solid #bbb', borderRadius: 3 };

function csvEscape(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(filename: string, content: string) {
  // BOM付きUTF-8でExcel互換
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
