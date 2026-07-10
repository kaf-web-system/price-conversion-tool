import { useState } from 'react';
import { parseShopifyCsv } from '../lib/shopifyParser';
import type { ShopifyParseResult, ShopifyRow } from '../lib/shopifyParser';
import { calculatePrice } from '../lib/parser';
import type { AmazonRow, CalcResult, KeywordRule } from '../lib/parser';

type ShopifyResult = CalcResult & { handle: string; originalTitle: string };

interface Props {
  rules: KeywordRule[];
  rulesSection: React.ReactNode;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

function csvEsc(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ShopifyTool({ rules, rulesSection }: Props) {
  const [file, setFile]             = useState<File | null>(null);
  const [activeOnly, setActiveOnly]  = useState(true);
  const [loading, setLoading]        = useState(false);
  const [error, setError]            = useState<string | null>(null);
  const [inventoryMsg, setInventoryMsg] = useState<string | null>(null);
  const [results, setResults]        = useState<ShopifyResult[] | null>(null);
  const [parseInfo, setParseInfo]    = useState<Omit<ShopifyParseResult, 'rows'> | null>(null);

  const autoResults   = results?.filter((r) => r.newPrice !== null) ?? [];
  const manualResults = results?.filter((r) => r.newPrice === null) ?? [];

  const reasonCounts = manualResults.reduce<Record<string, number>>((acc, r) => {
    const key = r.manualReason ?? '（理由不明）';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const cableUnregisteredCount = results?.filter((r) => r.cableRateUnregistered).length ?? 0;

  const onRun = async () => {
    if (!file) { setError('CSVファイルを選択してください'); return; }
    if (rules.length === 0) { setError('ルールを1件以上設定してください'); return; }

    setError(null);
    setInventoryMsg(null);
    setResults(null);
    setParseInfo(null);
    setLoading(true);
    await new Promise((r) => setTimeout(r, 30));

    try {
      const text = await file.text();
      const { rows: shopifyRows, totalRaw, skipNoPrice, skipNoTitle, skipStatus } = parseShopifyCsv(text, activeOnly);
      setParseInfo({ totalRaw, skipNoPrice, skipNoTitle, skipStatus });

      if (shopifyRows.length === 0) {
        setError(
          activeOnly
            ? 'Activeの商品が0件です。「Activeのみ対象」を外して再確認するか、CSVの列名を確認してください。'
            : '取り込める行が0件です。CSVの列名（Handle / Title / Variant Price）を確認してください。'
        );
        return;
      }

      let inventoryMap = new Map<string, string>();
      let inventoryDbCount = 0;
      let inventoryFetchFailed = false;
      try {
        if (supabaseUrl && supabaseKey) {
          const resp = await fetch(`${supabaseUrl}/rest/v1/stock?select=sku,plug_name`, {
            headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
          });
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
        const matchedCount = shopifyRows.filter((r) => inventoryMap.has(r.sku)).length;
        setInventoryMsg(`在庫DB：${inventoryDbCount}件のプラグ名を読み込み（今回の商品のうち${matchedCount}件にplug_nameを付与）`);
      }

      const computed: ShopifyResult[] = shopifyRows.map((sr: ShopifyRow) => {
        const amazonRow: AmazonRow = {
          sku: sr.sku, asin: '',
          productName: sr.synthesizedTitle,
          description: '', bulletPoints: '',
          currentPrice: sr.currentPrice, status: sr.status,
          raw: {},
        };
        const calc: CalcResult = calculatePrice(amazonRow, rules, inventoryMap.get(sr.sku) ?? '');
        return { ...calc, handle: sr.handle, originalTitle: sr.originalTitle };
      });

      setResults(computed);
    } catch (e) {
      setError(`処理中に不明なエラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadAuto = () => {
    if (!results) return;
    const lines = ['Handle,Title,Variant SKU,Variant Price'];
    for (const r of results) {
      if (r.newPrice !== null) lines.push(`${csvEsc(r.handle)},${csvEsc(r.originalTitle)},${csvEsc(r.sku)},${r.newPrice}`);
    }
    download('shopify_price_update.csv', lines.join('\n'));
  };

  const downloadManual = () => {
    if (!results) return;
    const lines = ['Handle,Variant SKU,Title,現在価格,手動対応理由'];
    for (const r of results) {
      if (r.newPrice === null) lines.push(`${csvEsc(r.handle)},${csvEsc(r.sku)},${csvEsc(r.originalTitle)},${r.currentPrice},${csvEsc(r.manualReason ?? '')}`);
    }
    download('shopify_manual_review.csv', lines.join('\n'));
  };

  const preview = results?.slice(0, 50) ?? [];

  return (
    <div>
      {/* 1. ファイル選択 */}
      <section style={card}>
        <h2>1. Shopify商品CSVを選ぶ</h2>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResults(null); setError(null); setInventoryMsg(null); setParseInfo(null);
          }}
        />
        <label style={{ marginLeft: 16 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          {' '}Activeのみ対象（Status が active または空欄の行）
        </label>
        {file && (
          <p style={{ color: '#888', fontSize: 13, margin: '4px 0 0' }}>
            {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
      </section>

      {/* 2. キーワード設定（App.tsx から渡されたノード） */}
      {rulesSection}

      {/* 3. 実行 */}
      <section style={card}>
        <h2>3. 実行</h2>
        <button
          onClick={onRun}
          disabled={loading}
          style={{
            padding: '10px 28px', fontSize: 16, border: 0, borderRadius: 4,
            cursor: loading ? 'wait' : 'pointer',
            background: loading ? '#aaa' : '#0070f3', color: '#fff',
            fontWeight: 600, letterSpacing: '0.02em',
          }}
        >
          {loading ? '計算中...' : '価格改定を実行（Shopify）'}
        </button>

        {error && (
          <div style={{ color: '#c00', marginTop: 12, padding: '10px 14px', background: '#fff5f5', border: '1px solid #fcc', borderRadius: 4, fontSize: 14 }}>
            <b>エラー:</b> {error}
          </div>
        )}
      </section>

      {/* 診断パネル */}
      {(parseInfo !== null || inventoryMsg !== null) && (
        <section style={card}>
          <h2>診断パネル</h2>
          {inventoryMsg !== null && (
            <div style={{ marginBottom: 10, padding: '6px 12px', background: inventoryMsg.includes('失敗') ? '#fff5f5' : '#f0f8ff', border: `1px solid ${inventoryMsg.includes('失敗') ? '#fcc' : '#b0d4f0'}`, borderRadius: 4, fontSize: 13 }}>
              {inventoryMsg.includes('失敗') ? '❌' : 'ℹ️'} {inventoryMsg}
            </div>
          )}
          {parseInfo !== null && results !== null && (
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <tr><td style={diagTh}>CSV取込行数（Handle あり）</td><td style={diagTd}>{parseInfo.totalRaw.toLocaleString()} 件</td></tr>
                <tr><td style={{ ...diagTh, paddingLeft: 16, color: '#888', fontWeight: 'normal' }}>└ 価格なし（読み飛ばし）</td><td style={{ ...diagTd, color: '#888' }}>{parseInfo.skipNoPrice.toLocaleString()} 件</td></tr>
                <tr><td style={{ ...diagTh, paddingLeft: 16, color: '#888', fontWeight: 'normal' }}>└ Title空（補完後も）</td><td style={{ ...diagTd, color: '#888' }}>{parseInfo.skipNoTitle.toLocaleString()} 件</td></tr>
                {activeOnly && <tr><td style={{ ...diagTh, paddingLeft: 16, color: '#888', fontWeight: 'normal' }}>└ Status除外（Active以外）</td><td style={{ ...diagTd, color: '#888' }}>{parseInfo.skipStatus.toLocaleString()} 件</td></tr>}
                <tr><td style={diagTh}>有効行（計算対象）</td><td style={{ ...diagTd, fontWeight: 'bold' }}>{results.length.toLocaleString()} 件</td></tr>
                <tr><td style={diagTh}>自動改定</td><td style={{ ...diagTd, color: '#047857', fontWeight: 'bold' }}>{autoResults.length.toLocaleString()} 件</td></tr>
                <tr><td style={diagTh}>手動対応</td><td style={{ ...diagTd, color: '#b45309', fontWeight: 'bold' }}>{manualResults.length.toLocaleString()} 件</td></tr>
                {Object.entries(reasonCounts).map(([reason, count]) => (
                  <tr key={reason}><td style={{ ...diagTh, paddingLeft: 16, color: '#888', fontWeight: 'normal' }}>└ {reason}</td><td style={{ ...diagTd, color: '#888' }}>{count.toLocaleString()} 件</td></tr>
                ))}
                {cableUnregisteredCount > 0 && <tr><td style={{ ...diagTh, color: '#c00' }}>ケーブル単価未登録フラグ</td><td style={{ ...diagTd, color: '#c00', fontWeight: 'bold' }}>{cableUnregisteredCount.toLocaleString()} 件</td></tr>}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* 4. 結果 */}
      {results !== null && (
        <section style={card}>
          <h2>4. 結果</h2>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <button onClick={downloadAuto} disabled={autoResults.length === 0} style={btnDownloadGreen}>
              自動改定CSVをダウンロード（{autoResults.length}件）
            </button>
            <button onClick={downloadManual} disabled={manualResults.length === 0} style={btnDownloadOrange}>
              手動対応リストCSVをダウンロード（{manualResults.length}件）
            </button>
          </div>

          <h3 style={{ margin: '0 0 8px' }}>プレビュー（先頭50件）</h3>
          <div style={{ overflow: 'auto', maxHeight: 500, border: '1px solid #ddd' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f0f0f0', position: 'sticky', top: 0 }}>
                  <th style={th}>Handle</th><th style={th}>Title（原本）</th><th style={th}>マッチ用合成名</th>
                  <th style={th}>SKU</th><th style={th}>マッチルール</th><th style={th}>長さ(m)</th>
                  <th style={th}>個数</th><th style={th}>現価格</th><th style={th}>新価格</th>
                  <th style={th}>差額</th><th style={th}>手動理由</th><th style={th}>単価未登録</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} style={{ background: r.newPrice === null ? '#fff8e1' : r.cableRateUnregistered ? '#fff0f0' : 'transparent', borderTop: '1px solid #eee' }}>
                    <td style={td}>{r.handle}</td>
                    <td style={tdClamp} title={r.originalTitle}>{r.originalTitle.slice(0, 40)}{r.originalTitle.length > 40 ? '…' : ''}</td>
                    <td style={tdClamp} title={r.productName}>{r.productName.slice(0, 40)}{r.productName.length > 40 ? '…' : ''}</td>
                    <td style={td}>{r.sku || '—'}</td>
                    <td style={td}>{r.allMatchedLabels || '-'}</td>
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
    </div>
  );
}

const card: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 6, padding: 16, marginTop: 16 };
const th: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 8px', textAlign: 'left' };
const td: React.CSSProperties = { border: '1px solid #eee', padding: '4px 8px', verticalAlign: 'top' };
const tdClamp: React.CSSProperties = { border: '1px solid #eee', padding: '4px 8px', verticalAlign: 'top', maxWidth: 180, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const diagTh: React.CSSProperties = { padding: '3px 12px 3px 0', fontWeight: 'bold', whiteSpace: 'nowrap', verticalAlign: 'top', color: '#444' };
const diagTd: React.CSSProperties = { padding: '3px 0', verticalAlign: 'top' };
const btnDownloadGreen: React.CSSProperties = { padding: '10px 22px', fontSize: 15, fontWeight: 700, background: '#047857', color: '#fff', border: 0, borderRadius: 5, cursor: 'pointer', letterSpacing: '0.02em' };
const btnDownloadOrange: React.CSSProperties = { padding: '10px 22px', fontSize: 15, fontWeight: 700, background: '#b45309', color: '#fff', border: 0, borderRadius: 5, cursor: 'pointer', letterSpacing: '0.02em' };
