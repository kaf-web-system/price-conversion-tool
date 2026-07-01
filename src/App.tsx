import { useMemo, useRef, useState } from 'react';
import { parseFile } from './fileParser';
import type { FileDiagInfo } from './fileParser';
import { calculatePrice } from '../lib/parser';
import type { AmazonRow, CalcResult, KeywordRule } from '../lib/parser';
import { parseRulesTxt } from '../lib/ruleParser';
import StockEditor from './StockEditor';

type Tab = 'price' | 'stock';

type ProcessedData = {
  total: number;
  autoCount: number;
  manualCount: number;
  preview: CalcResult[];
  results: CalcResult[];
};

const DEFAULT_RULES: KeywordRule[] = [
  { id: '1', label: 'BELDEN 88760',  pattern: 'BELDEN\\s*88760',   cablePerMeter: 200, plugPerPiece: 300 },
  { id: '2', label: 'MOGAMI 2534',   pattern: 'MOGAMI\\s*2534',    cablePerMeter: 150, plugPerPiece: 300 },
  { id: '3', label: 'CANARE L-4E6S', pattern: 'CANARE\\s*L-?4E6S', cablePerMeter: 100, plugPerPiece: 250 },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('price');
  const [files, setFiles]         = useState<File[]>([]);
  const [rules, setRules]         = useState<KeywordRule[]>(DEFAULT_RULES);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [warnings, setWarnings]   = useState<string[]>([]);
  const [diagInfos, setDiagInfos] = useState<FileDiagInfo[]>([]);
  const [data, setData]           = useState<ProcessedData | null>(null);
  const [ruleLoadMsg, setRuleLoadMsg] = useState<string | null>(null);
  const [inventoryMsg, setInventoryMsg] = useState<string | null>(null);
  const ruleFileRef = useRef<HTMLInputElement>(null);

  const updateRule = (i: number, patch: Partial<KeywordRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRule = () =>
    setRules((rs) => [
      ...rs,
      { id: String(Date.now()), label: '', pattern: '', cablePerMeter: 0, plugPerPiece: 0 },
    ]);

  const removeRule = (i: number) =>
    setRules((rs) => rs.filter((_, idx) => idx !== i));

  const onRuleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // 読み込み後に同じファイルを再選択できるようリセット
    if (ruleFileRef.current) ruleFileRef.current.value = '';

    try {
      const text = await file.text();
      const { rules: loaded, warnings: warns } = parseRulesTxt(text);
      if (loaded.length === 0) {
        setRuleLoadMsg('警告: ルールが0件でした。ファイルの書式を確認してください。');
        return;
      }
      setRules(loaded);
      const warnSuffix = warns.length > 0 ? `（警告${warns.length}件: ${warns.slice(0, 3).join(' / ')}${warns.length > 3 ? ' ...' : ''}）` : '';
      setRuleLoadMsg(`${loaded.length} 件のルールを読み込みました${warnSuffix}`);
    } catch (err) {
      setRuleLoadMsg(`読み込みエラー: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onSubmit = async () => {
    if (files.length === 0) {
      setError('CSV または Excel ファイルを選んでください');
      return;
    }
    if (rules.length === 0) {
      setError('ルールを1件以上設定してください');
      return;
    }

    setError(null);
    setWarnings([]);
    setDiagInfos([]);
    setInventoryMsg(null);
    setLoading(true);
    setData(null);

    // UIを確実に再描画させてから重い処理へ
    await new Promise((r) => setTimeout(r, 30));

    try {
      const allRows: AmazonRow[] = [];
      const collectedDiags: FileDiagInfo[] = [];
      const fileErrors: string[] = [];

      for (const file of files) {
        // parseFile は例外を投げず { rows, diag } を返す設計
        const { rows, diag } = await parseFile(file, { activeOnly });
        collectedDiags.push(diag);
        if (diag.error) {
          fileErrors.push(`${file.name}: ${diag.error}`);
        }
        allRows.push(...rows);
      }

      setDiagInfos(collectedDiags);

      if (fileErrors.length > 0 && allRows.length === 0) {
        setError('すべてのファイルの読み込みに失敗しました。下の診断パネルを確認してください。');
        return;
      }
      if (fileErrors.length > 0) {
        setWarnings(fileErrors);
      }

      if (allRows.length === 0) {
        setError(
          activeOnly
            ? 'ステータス「有効」の商品が0件です。「Activeのみ対象」を外して再実行するか、診断パネルで列検出状況を確認してください。'
            : '読み込める商品行が0件です。診断パネルでシート名・列検出状況を確認してください。'
        );
        return;
      }

      // ── 在庫DB から plug_name を取得 ──────────────────────────────
      let inventoryMap = new Map<string, string>();
      let inventoryDbCount = 0;
      let inventoryFetchFailed = false;
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        if (supabaseUrl && supabaseKey) {
          const resp = await fetch(
            `${supabaseUrl}/rest/v1/stock?select=sku,plug_name`,
            { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
          );
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const dbRows: { sku: string; plug_name: string | null }[] = await resp.json();
          inventoryDbCount = dbRows.length;
          for (const dbRow of dbRows) {
            if (dbRow.sku && dbRow.plug_name) inventoryMap.set(dbRow.sku, dbRow.plug_name);
          }
        }
      } catch (e) {
        inventoryFetchFailed = true;
        setInventoryMsg(`在庫DB：読み込み失敗（${e instanceof Error ? e.message : String(e)}）`);
      }

      if (!inventoryFetchFailed) {
        const matchedCount = allRows.filter((r) => inventoryMap.has(r.sku)).length;
        setInventoryMsg(
          `在庫DB：${inventoryDbCount}件のプラグ名を読み込み（今回の商品のうち${matchedCount}件にplug_nameを付与）`
        );
      }
      // ─────────────────────────────────────────────────────────────

      const results = allRows.map((r) => {
        try {
          const plugName = inventoryMap.get(r.sku) ?? '';
          return { ...calculatePrice(r, rules, plugName), description: r.description, bulletPoints: r.bulletPoints };
        } catch (e) {
          return {
            sku: r.sku,
            asin: r.asin,
            productName: r.productName,
            description: r.description,
            bulletPoints: r.bulletPoints,
            currentPrice: r.currentPrice,
            newPrice: null,
            diff: null,
            matchedRuleLabel: null,
            lengthM: null,
            pieces: null,
            manualReason: `計算エラー: ${e instanceof Error ? e.message : String(e)}`,
            cableRateUnregistered: false,
          } satisfies CalcResult;
        }
      });

      const auto   = results.filter((r) => r.newPrice !== null);
      const manual = results.filter((r) => r.newPrice === null);

      setData({
        total: allRows.length,
        autoCount: auto.length,
        manualCount: manual.length,
        preview: results.slice(0, 50),
        results,
      });
    } catch (e) {
      setError(`処理中に不明なエラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadAuto = () => {
    if (!data) return;
    const lines = ['sku,price,ケーブル単価未登録'];
    for (const r of data.results) {
      if (r.newPrice !== null) {
        lines.push(`${csvEscape(r.sku)},${r.newPrice},${r.cableRateUnregistered ? '1' : '0'}`);
      }
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
    const cableUnregisteredCount = data.results.filter((r) => r.cableRateUnregistered).length;
    return { rate, cableUnregisteredCount };
  }, [data]);

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'sans-serif', background: '#fff', color: '#000', minHeight: '100vh' }}>
      {/* タブバー */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #ddd' }}>
        {([['price', '価格改定ツール'], ['stock', '在庫DB編集']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: tab === key ? 700 : 400,
              background: 'none',
              border: 'none',
              borderBottom: tab === key ? '2px solid #0070f3' : '2px solid transparent',
              marginBottom: -2,
              color: tab === key ? '#0070f3' : '#555',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'stock' && <StockEditor />}
      {tab === 'price' && (
        <>
      <h1>Amazon価格改定ツール（プロトタイプ）</h1>
      <p style={{ color: '#555' }}>
        商品名・商品説明・仕様のキーワード一致で「ケーブル単価×長さ＋プラグ単価×個数」を現在価格に加算します。
        処理はすべてブラウザ内で完結します。
      </p>

      <section style={card}>
        <h2>1. ファイルを選ぶ（複数可・CSV / Excel .xlsx/.xlsm）</h2>
        <input
          type="file"
          accept=".csv,.xlsx,.xls,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroenabled.12"
          multiple
          onChange={(e) => {
            // ファイル変更時だけ files を更新。エラー時は files をクリアしない
            setFiles(Array.from(e.target.files ?? []));
            setData(null);
            setDiagInfos([]);
            setError(null);
            setWarnings([]);
          }}
        />
        <label style={{ marginLeft: 16 }}>
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
          />
          {' '}Activeのみ対象（xlsm: ステータス「有効」のみ）
        </label>
        {files.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {files.map((f, i) => (
              <p key={i} style={{ color: '#888', fontSize: 13, margin: '2px 0' }}>
                {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)
              </p>
            ))}
          </div>
        )}
      </section>

      <section style={card}>
        <h2>2. キーワードと加算額を設定</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 12px', background: '#f5f8ff', border: '1px solid #c8d8f0', borderRadius: 4 }}>
          <span style={{ fontSize: 13, color: '#444', whiteSpace: 'nowrap' }}>値上げルール表を読み込む（.txt / .csv）:</span>
          <input
            ref={ruleFileRef}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            style={{ fontSize: 13 }}
            onChange={onRuleFileChange}
          />
          {ruleLoadMsg && (
            <span style={{ fontSize: 12, color: ruleLoadMsg.startsWith('読み込みエラー') || ruleLoadMsg.startsWith('警告') ? '#c00' : '#080' }}>
              {ruleLoadMsg}
            </span>
          )}
        </div>
        <p style={{ color: '#666', fontSize: 13 }}>
          パターンは正規表現で書けます（例: <code>MOGAMI\s*2534</code>）。先に書いたルールから順に判定し、最初にマッチしたものが採用されます。
          マッチ対象は「商品名＋商品説明＋商品の仕様#1〜#5」の連結テキストです。1m単価が0のルールにマッチした商品は「ケーブル単価未登録」フラグが立ちます。
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
                  <input style={inp} value={r.label} onChange={(e) => updateRule(i, { label: e.target.value })} />
                </td>
                <td style={td}>
                  <input style={inp} value={r.pattern} onChange={(e) => updateRule(i, { pattern: e.target.value })} />
                </td>
                <td style={td}>
                  <input type="number" style={inp} value={r.cablePerMeter} onChange={(e) => updateRule(i, { cablePerMeter: Number(e.target.value) })} />
                </td>
                <td style={td}>
                  <input type="number" style={inp} value={r.plugPerPiece} onChange={(e) => updateRule(i, { plugPerPiece: Number(e.target.value) })} />
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
          {loading ? '計算中（ブラウザ内処理）...' : '価格改定を実行'}
        </button>

        {error && (
          <div style={{ color: '#c00', marginTop: 12, padding: '10px 14px', background: '#fff5f5', border: '1px solid #fcc', borderRadius: 4, fontSize: 14, whiteSpace: 'pre-wrap' }}>
            <b>エラー:</b> {error}
          </div>
        )}

        {warnings.length > 0 && (
          <div style={{ color: '#a60', marginTop: 12, padding: '10px 14px', background: '#fffbf0', border: '1px solid #f5c', borderRadius: 4, fontSize: 13, whiteSpace: 'pre-wrap' }}>
            <b>警告（一部ファイルを読み飛ばし）:</b>{'\n'}{warnings.join('\n')}
          </div>
        )}
      </section>

      {/* 診断パネル: 実行後に常に表示 */}
      {(diagInfos.length > 0 || inventoryMsg !== null) && (
        <section style={card}>
          <h2>診断パネル（ファイル読み込み詳細）</h2>
          {inventoryMsg !== null && (
            <div style={{ marginBottom: 10, padding: '6px 12px', background: inventoryMsg.includes('失敗') ? '#fff5f5' : '#f0f8ff', border: `1px solid ${inventoryMsg.includes('失敗') ? '#fcc' : '#b0d4f0'}`, borderRadius: 4, fontSize: 13 }}>
              {inventoryMsg.includes('失敗') ? '❌' : 'ℹ️'} {inventoryMsg}
            </div>
          )}
          {diagInfos.map((d, i) => (
            <div key={i} style={{ marginBottom: 16, padding: '10px 14px', background: d.error ? '#fff5f5' : '#f8fff8', border: `1px solid ${d.error ? '#fcc' : '#cec'}`, borderRadius: 4, fontSize: 13 }}>
              <p style={{ margin: '0 0 6px', fontWeight: 'bold', fontSize: 14 }}>
                {d.error ? '❌' : '✅'} {d.filename}
              </p>
              <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  <tr>
                    <td style={diagTh}>ワークブック内シート</td>
                    <td style={diagTd}>
                      {d.sheetNames.length === 0
                        ? '（取得できず）'
                        : d.sheetNames.map((s, j) => (
                            <span key={j} style={{ marginRight: 8, background: s === 'テンプレート' ? '#d0f0d0' : '#eee', padding: '1px 6px', borderRadius: 3 }}>
                              {s}
                            </span>
                          ))}
                    </td>
                  </tr>
                  <tr>
                    <td style={diagTh}>「テンプレート」シート</td>
                    <td style={diagTd}>{d.hasTemplateSheet ? '見つかった ✅' : '見つからなかった ❌'}</td>
                  </tr>
                  <tr>
                    <td style={diagTh}>実データ行数</td>
                    <td style={diagTd}>{d.dataRowCount.toLocaleString()} 件</td>
                  </tr>
                  <tr>
                    <td style={diagTh}>SKU列</td>
                    <td style={diagTd}>{d.columns.sku !== null ? `列インデックス ${d.columns.sku} で検出` : '未検出'}</td>
                  </tr>
                  <tr>
                    <td style={diagTh}>商品名列</td>
                    <td style={diagTd}>{d.columns.name !== null ? `列インデックス ${d.columns.name} で検出` : '未検出'}</td>
                  </tr>
                  <tr>
                    <td style={diagTh}>販売価格列</td>
                    <td style={diagTd}>{d.columns.price !== null ? `列インデックス ${d.columns.price} で検出` : '未検出'}</td>
                  </tr>
                  <tr>
                    <td style={diagTh}>ステータス列</td>
                    <td style={diagTd}>{d.columns.status !== null ? `列インデックス ${d.columns.status} で検出` : '未検出'}</td>
                  </tr>
                  {d.error && (
                    <tr>
                      <td style={{ ...diagTh, color: '#c00' }}>エラー</td>
                      <td style={{ ...diagTd, color: '#c00', whiteSpace: 'pre-wrap' }}>{d.error}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      {data && (
        <section style={card}>
          <h2>4. 結果</h2>
          <p>
            読み込み件数: <b>{data.total.toLocaleString()}</b> 件 ／
            自動改定: <b style={{ color: '#080' }}>{data.autoCount.toLocaleString()}</b> 件 ／
            手動対応: <b style={{ color: '#c80' }}>{data.manualCount.toLocaleString()}</b> 件
            （自動率 {stats?.rate}%）
          </p>
          {(stats?.cableUnregisteredCount ?? 0) > 0 && (
            <p style={{ color: '#c00', fontSize: 13, margin: '4px 0' }}>
              ケーブル単価未登録フラグ: <b>{stats!.cableUnregisteredCount.toLocaleString()}</b> 件
            </p>
          )}
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
                  <th style={th}>商品説明</th>
                  <th style={th}>商品仕様</th>
                  <th style={th}>マッチ</th>
                  <th style={th}>長さ(m)</th>
                  <th style={th}>個数</th>
                  <th style={th}>現価格</th>
                  <th style={th}>新価格</th>
                  <th style={th}>差額</th>
                  <th style={th}>手動理由</th>
                  <th style={th}>ケーブル単価未登録</th>
                </tr>
              </thead>
              <tbody>
                {data.preview.map((r, i) => (
                  <tr
                    key={i}
                    style={{
                      background:
                        r.newPrice === null
                          ? '#fff8e1'
                          : r.cableRateUnregistered
                          ? '#fff0f0'
                          : 'transparent',
                    }}
                  >
                    <td style={td}>{r.sku}</td>
                    <td style={td} title={r.productName}>
                      {r.productName.slice(0, 40)}{r.productName.length > 40 ? '…' : ''}
                    </td>
                    <td style={tdClamp} title={r.description}>
                      {r.description.slice(0, 80)}{r.description.length > 80 ? '…' : ''}
                    </td>
                    <td style={tdClamp} title={r.bulletPoints}>
                      {r.bulletPoints.slice(0, 80)}{r.bulletPoints.length > 80 ? '…' : ''}
                    </td>
                    <td style={td}>{r.matchedRuleLabel ?? '-'}</td>
                    <td style={td}>{r.lengthM ?? '-'}</td>
                    <td style={td}>{r.pieces ?? '-'}</td>
                    <td style={td}>{r.currentPrice.toLocaleString()}</td>
                    <td style={td}>{r.newPrice !== null ? r.newPrice.toLocaleString() : '-'}</td>
                    <td style={td}>{r.diff !== null ? `+${r.diff.toLocaleString()}` : '-'}</td>
                    <td style={td}>{r.manualReason ?? ''}</td>
                    <td style={td}>{r.cableRateUnregistered ? '●' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      </>
      )}
    </main>
  );
}

const card: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 16 };
const th: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 8px', textAlign: 'left' };
const td: React.CSSProperties = { border: '1px solid #eee', padding: '4px 8px', verticalAlign: 'top' };
const tdClamp: React.CSSProperties = { border: '1px solid #eee', padding: '4px 8px', verticalAlign: 'top', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const inp: React.CSSProperties = { width: '100%', padding: 6, boxSizing: 'border-box', background: '#fff', color: '#000', border: '1px solid #bbb', borderRadius: 3 };
const diagTh: React.CSSProperties = { padding: '3px 10px 3px 0', fontWeight: 'bold', whiteSpace: 'nowrap', verticalAlign: 'top', color: '#444' };
const diagTd: React.CSSProperties = { padding: '3px 0', verticalAlign: 'top' };

function csvEscape(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(filename: string, content: string) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
