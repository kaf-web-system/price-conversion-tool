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
      <section className="border border-gray-300 rounded-md p-4 mt-4">
        <h2>1. Shopify商品CSVを選ぶ</h2>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResults(null); setError(null); setInventoryMsg(null); setParseInfo(null);
          }}
        />
        <label className="ml-4">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          {' '}Activeのみ対象（Status が active または空欄の行）
        </label>
        {file && (
          <p className="text-gray-500 text-[13px] mt-1">
            {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
      </section>

      {/* 2. キーワード設定（App.tsx から渡されたノード） */}
      {rulesSection}

      {/* 3. 実行 */}
      <section className="border border-gray-300 rounded-md p-4 mt-4">
        <h2>3. 実行</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={onRun}
            disabled={loading}
            className={`px-7 py-2.5 text-base font-semibold border-0 rounded text-white tracking-wide ${
              loading ? 'bg-gray-400 cursor-wait' : 'bg-[#0070f3] cursor-pointer'
            }`}
          >
            {loading ? '計算中...' : '価格改定を実行'}
          </button>
          <span className="px-3 py-1 text-sm font-bold text-white rounded bg-[#95BF47]">Shopify</span>
        </div>

        {error && (
          <div className="text-red-700 mt-3 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded text-sm">
            <b>エラー:</b> {error}
          </div>
        )}
      </section>

      {/* 診断パネル */}
      {(parseInfo !== null || inventoryMsg !== null) && (
        <section className="border border-gray-300 rounded-md p-4 mt-4">
          <h2>診断パネル</h2>
          {inventoryMsg !== null && (
            <div className={`mb-2.5 px-3 py-1.5 rounded text-[13px] border ${inventoryMsg.includes('失敗') ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
              {inventoryMsg.includes('失敗') ? '❌' : 'ℹ️'} {inventoryMsg}
            </div>
          )}
          {parseInfo !== null && results !== null && (
            <table className="border-collapse text-[13px]">
              <tbody>
                <tr>
                  <td className="pr-3 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">CSV取込行数（Handle あり）</td>
                  <td className="py-0.5 align-top">{parseInfo.totalRaw.toLocaleString()} 件</td>
                </tr>
                <tr>
                  <td className="pr-3 py-0.5 whitespace-nowrap align-top text-gray-400 font-normal pl-4">└ 価格なし（読み飛ばし）</td>
                  <td className="py-0.5 align-top text-gray-400">{parseInfo.skipNoPrice.toLocaleString()} 件</td>
                </tr>
                <tr>
                  <td className="pr-3 py-0.5 whitespace-nowrap align-top text-gray-400 font-normal pl-4">└ Title空（補完後も）</td>
                  <td className="py-0.5 align-top text-gray-400">{parseInfo.skipNoTitle.toLocaleString()} 件</td>
                </tr>
                {activeOnly && (
                  <tr>
                    <td className="pr-3 py-0.5 whitespace-nowrap align-top text-gray-400 font-normal pl-4">└ Status除外（Active以外）</td>
                    <td className="py-0.5 align-top text-gray-400">{parseInfo.skipStatus.toLocaleString()} 件</td>
                  </tr>
                )}
                <tr>
                  <td className="pr-3 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">有効行（計算対象）</td>
                  <td className="py-0.5 align-top font-bold">{results.length.toLocaleString()} 件</td>
                </tr>
                <tr>
                  <td className="pr-3 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">自動改定</td>
                  <td className="py-0.5 align-top text-emerald-700 font-bold">{autoResults.length.toLocaleString()} 件</td>
                </tr>
                <tr>
                  <td className="pr-3 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">手動対応</td>
                  <td className="py-0.5 align-top text-amber-700 font-bold">{manualResults.length.toLocaleString()} 件</td>
                </tr>
                {Object.entries(reasonCounts).map(([reason, count]) => (
                  <tr key={reason}>
                    <td className="pr-3 py-0.5 whitespace-nowrap align-top text-gray-400 font-normal pl-4">└ {reason}</td>
                    <td className="py-0.5 align-top text-gray-400">{count.toLocaleString()} 件</td>
                  </tr>
                ))}
                {cableUnregisteredCount > 0 && (
                  <tr>
                    <td className="pr-3 py-0.5 font-bold whitespace-nowrap align-top text-red-600">ケーブル単価未登録フラグ</td>
                    <td className="py-0.5 align-top text-red-600 font-bold">{cableUnregisteredCount.toLocaleString()} 件</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* 4. 結果 */}
      {results !== null && (
        <section className="border border-gray-300 rounded-md p-4 mt-4">
          <h2>4. 結果</h2>
          <div className="flex gap-3 mb-4 flex-wrap">
            <button onClick={downloadAuto} disabled={autoResults.length === 0} className="px-5 py-2.5 text-[15px] font-bold bg-emerald-700 text-white border-0 rounded cursor-pointer tracking-wide disabled:opacity-50">
              自動改定CSVをダウンロード（{autoResults.length}件）
            </button>
            <button onClick={downloadManual} disabled={manualResults.length === 0} className="px-5 py-2.5 text-[15px] font-bold bg-amber-700 text-white border-0 rounded cursor-pointer tracking-wide disabled:opacity-50">
              手動対応リストCSVをダウンロード（{manualResults.length}件）
            </button>
          </div>

          <h3 className="mb-2">プレビュー（先頭50件）</h3>
          <div className="overflow-auto max-h-[500px] border border-gray-300">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100 sticky top-0">
                  <th className="border border-gray-300 px-2 py-1.5 text-left">Handle</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">Title（原本）</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">マッチ用合成名</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">SKU</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">マッチルール</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">長さ(m)</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">個数</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">現価格</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">新価格</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">差額</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">手動理由</th>
                  <th className="border border-gray-300 px-2 py-1.5 text-left">単価未登録</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className={`border-t border-gray-200 ${r.newPrice === null ? 'bg-amber-50' : r.cableRateUnregistered ? 'bg-red-50' : ''}`}>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.handle}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top max-w-[180px] truncate" title={r.originalTitle}>{r.originalTitle.slice(0, 40)}{r.originalTitle.length > 40 ? '…' : ''}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top max-w-[180px] truncate" title={r.productName}>{r.productName.slice(0, 40)}{r.productName.length > 40 ? '…' : ''}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.sku || '—'}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.allMatchedLabels || '-'}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.lengthM ?? '-'}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.pieces ?? '-'}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.currentPrice.toLocaleString()}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.newPrice !== null ? r.newPrice.toLocaleString() : '-'}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.diff !== null ? `+${r.diff.toLocaleString()}` : '-'}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.manualReason ?? ''}</td>
                    <td className="border border-gray-200 px-2 py-1 align-top">{r.cableRateUnregistered ? '●' : ''}</td>
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
