import { useEffect, useMemo, useRef, useState } from 'react';
import { parseFile } from './fileParser';
import type { FileDiagInfo } from './fileParser';
import { calculatePrice } from '../lib/parser';
import type { AmazonRow, CalcResult, KeywordRule } from '../lib/parser';
import { parseRulesTxt } from '../lib/ruleParser';
import StockEditor from './StockEditor';
import ShopifyTool from './ShopifyTool';

type Tab = 'price' | 'stock';
type Platform = 'amazon' | 'shopify';

type ProcessedData = {
  total: number;
  autoCount: number;
  manualCount: number;
  preview: CalcResult[];
  results: CalcResult[];
};

const LS_RULES_KEY = 'price_tool_rules_v1';

const DEFAULT_RULES: KeywordRule[] = [
  { id: '1', label: 'BELDEN 88760',  pattern: 'BELDEN\\s*88760',   cablePerMeter: 200, plugPerPiece: 300 },
  { id: '2', label: 'MOGAMI 2534',   pattern: 'MOGAMI\\s*2534',    cablePerMeter: 150, plugPerPiece: 300 },
  { id: '3', label: 'CANARE L-4E6S', pattern: 'CANARE\\s*L-?4E6S', cablePerMeter: 100, plugPerPiece: 250 },
];

function loadRulesFromStorage(): KeywordRule[] {
  try {
    const raw = localStorage.getItem(LS_RULES_KEY);
    if (!raw) return DEFAULT_RULES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as KeywordRule[];
  } catch { /* ignore */ }
  return DEFAULT_RULES;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('price');
  const [platform, setPlatform] = useState<Platform>('amazon');
  const [files, setFiles]         = useState<File[]>([]);
  const [rules, setRules]         = useState<KeywordRule[]>(loadRulesFromStorage);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [warnings, setWarnings]   = useState<string[]>([]);
  const [diagInfos, setDiagInfos] = useState<FileDiagInfo[]>([]);
  const [data, setData]           = useState<ProcessedData | null>(null);
  const [ruleLoadMsg, setRuleLoadMsg] = useState<string | null>(null);
  const [inventoryMsg, setInventoryMsg] = useState<string | null>(null);
  const [rulesCollapsed, setRulesCollapsed] = useState(true);
  const ruleFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(LS_RULES_KEY, JSON.stringify(rules)); } catch { /* ignore */ }
  }, [rules]);

  const updateRule = (i: number, patch: Partial<KeywordRule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const addRule = () =>
    setRules((rs) => [
      ...rs,
      { id: String(Date.now()), label: '', pattern: '', cablePerMeter: 0, plugPerPiece: 0 },
    ]);

  const removeRule = (i: number) => {
    const r = rules[i];
    if (!r) return;
    const name = r.label || r.pattern || '（名称未設定）';
    if (!window.confirm(`このルールを削除しますか？（対象の型番名: ${name}）`)) return;
    setRules((rs) => rs.filter((_, idx) => idx !== i));
  };

  const clearAllRules = () => {
    if (window.confirm(`ルールを全件（${rules.length}件）削除しますか？この操作は元に戻せません。`)) {
      setRules([]);
    }
  };

  const onRuleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    if (files.length === 0) { setError('CSV または Excel ファイルを選んでください'); return; }
    if (rules.length === 0) { setError('ルールを1件以上設定してください'); return; }

    setError(null);
    setWarnings([]);
    setDiagInfos([]);
    setInventoryMsg(null);
    setLoading(true);
    setData(null);

    await new Promise((r) => setTimeout(r, 30));

    try {
      const allRows: AmazonRow[] = [];
      const collectedDiags: FileDiagInfo[] = [];
      const fileErrors: string[] = [];

      for (const file of files) {
        const { rows, diag } = await parseFile(file, { activeOnly });
        collectedDiags.push(diag);
        if (diag.error) fileErrors.push(`${file.name}: ${diag.error}`);
        allRows.push(...rows);
      }

      setDiagInfos(collectedDiags);

      if (fileErrors.length > 0 && allRows.length === 0) {
        setError('すべてのファイルの読み込みに失敗しました。下の診断パネルを確認してください。');
        return;
      }
      if (fileErrors.length > 0) setWarnings(fileErrors);

      if (allRows.length === 0) {
        setError(
          activeOnly
            ? 'ステータス「有効」の商品が0件です。「Activeのみ対象」を外して再実行するか、診断パネルで列検出状況を確認してください。'
            : '読み込める商品行が0件です。診断パネルでシート名・列検出状況を確認してください。'
        );
        return;
      }

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
        setInventoryMsg(`在庫DB：${inventoryDbCount}件のプラグ名を読み込み（今回の商品のうち${matchedCount}件にplug_nameを付与）`);
      }

      const results = allRows.map((r) => {
        try {
          const plugName = inventoryMap.get(r.sku) ?? '';
          return { ...calculatePrice(r, rules, plugName), description: r.description, bulletPoints: r.bulletPoints };
        } catch (e) {
          return {
            sku: r.sku, asin: r.asin, productName: r.productName,
            description: r.description, bulletPoints: r.bulletPoints,
            currentPrice: r.currentPrice, newPrice: null, diff: null,
            matchedRuleLabel: null, lengthM: null, pieces: null,
            manualReason: `計算エラー: ${e instanceof Error ? e.message : String(e)}`,
            cableRateUnregistered: false,
            cableAdd: 0, plugAdd: 0, plugLabels: '', allMatchedLabels: '',
            matchSource: '',
          } satisfies CalcResult;
        }
      });

      const auto   = results.filter((r) => r.newPrice !== null);
      const manual = results.filter((r) => r.newPrice === null);
      setData({ total: allRows.length, autoCount: auto.length, manualCount: manual.length, preview: results.slice(0, 50), results });
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
      if (r.newPrice !== null) lines.push(`${csvEscape(r.sku)},${r.newPrice},${r.cableRateUnregistered ? '1' : '0'}`);
    }
    dl('amazon_price_update.csv', lines.join('\n'));
  };

  const downloadManual = () => {
    if (!data) return;
    const lines = ['sku,asin,商品名,現在価格,手動対応理由'];
    for (const r of data.results) {
      if (r.newPrice === null) {
        lines.push(`${csvEscape(r.sku)},${csvEscape(r.asin)},${csvEscape(r.productName)},${r.currentPrice},${csvEscape(r.manualReason ?? '')}`);
      }
    }
    dl('manual_review_list.csv', lines.join('\n'));
  };

  const downloadCheck = () => {
    if (!data) return;
    const lines = ['sku,asin,商品名,商品説明,商品仕様,現在価格,改定後価格,差額,マッチ,マッチ元,長さm,個数,ケーブル加算,プラグ加算,プラグ内訳,手動対応理由,ケーブル単価未登録'];
    for (const r of data.results) {
      const isAuto = r.newPrice !== null;
      lines.push([
        csvEscape(r.sku),
        csvEscape(r.asin),
        csvEscape(r.productName),
        csvEscape(r.description),
        csvEscape(r.bulletPoints),
        r.currentPrice,
        isAuto ? r.newPrice! : '',
        isAuto ? r.diff! : '',
        csvEscape(r.allMatchedLabels),
        csvEscape(r.matchSource),
        r.lengthM ?? '',
        r.pieces ?? '',
        isAuto ? r.cableAdd : '',
        isAuto ? r.plugAdd : '',
        isAuto ? csvEscape(r.plugLabels) : '',
        csvEscape(r.manualReason ?? ''),
        r.cableRateUnregistered ? '1' : '0',
      ].join(','));
    }
    dl('price_check_list.csv', lines.join('\n'));
  };

  const stats = useMemo(() => {
    if (!data) return null;
    const rate = data.total ? Math.round((data.autoCount / data.total) * 1000) / 10 : 0;
    const cableUnregisteredCount = data.results.filter((r) => r.cableRateUnregistered).length;
    return { rate, cableUnregisteredCount };
  }, [data]);

  const rulesSection = (
    <section className="border border-gray-300 rounded-md mt-4 overflow-hidden">
      <button
        onClick={() => setRulesCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 border-0 cursor-pointer text-left hover:bg-gray-100 transition-colors"
      >
        <span className="font-semibold text-sm">
          2. キーワードと加算額を設定
          <span className="ml-2 text-gray-500 font-normal">（{rules.length}件）</span>
        </span>
        <span className="text-gray-500 text-xs select-none">{rulesCollapsed ? '\u25BC 開く' : '\u25B2 閉じる'}</span>
      </button>
      {!rulesCollapsed && (
        <div className="p-4">
          <div className="flex items-center gap-2.5 mb-2.5 px-3 py-2 bg-[#f5f8ff] border border-[#c8d8f0] rounded flex-wrap">
            <span className="text-[13px] text-gray-600 whitespace-nowrap">値上げルール表を読み込む（.txt / .csv）:</span>
            <input
              ref={ruleFileRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="text-[13px]"
              onChange={onRuleFileChange}
            />
            {ruleLoadMsg && (
              <span className={`text-xs ${ruleLoadMsg.startsWith('読み込みエラー') || ruleLoadMsg.startsWith('警告') ? 'text-red-600' : 'text-green-700'}`}>
                {ruleLoadMsg}
              </span>
            )}
          </div>
          <p className="text-gray-500 text-[13px] mb-2.5">
            パターンは正規表現で書けます（例: <code>MOGAMI\s*2534</code>）。先に書いたルールから順に判定し、最初にマッチしたものが採用されます。
            マッチ対象は「商品名＋商品説明＋商品の仕様#1〜#5」の連結テキストです。1m単価が0のルールにマッチした商品は「ケーブル単価未登録」フラグが立ちます。
          </p>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-2 py-1.5 text-left">表示名</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">正規表現パターン</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">1m単価（円）</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left">プラグ単価（円）</th>
                <th className="border border-gray-300 px-2 py-1.5 text-left"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={r.id}>
                  <td className="border border-gray-200 px-2 py-1 align-top">
                    <input className="w-full px-1.5 py-1 bg-white text-black border border-gray-400 rounded box-border" value={r.label} onChange={(e) => updateRule(i, { label: e.target.value })} />
                  </td>
                  <td className="border border-gray-200 px-2 py-1 align-top">
                    <input className="w-full px-1.5 py-1 bg-white text-black border border-gray-400 rounded box-border" value={r.pattern} onChange={(e) => updateRule(i, { pattern: e.target.value })} />
                  </td>
                  <td className="border border-gray-200 px-2 py-1 align-top">
                    <input type="number" className="w-full px-1.5 py-1 bg-white text-black border border-gray-400 rounded box-border" value={r.cablePerMeter} onChange={(e) => updateRule(i, { cablePerMeter: Number(e.target.value) })} />
                  </td>
                  <td className="border border-gray-200 px-2 py-1 align-top">
                    <input type="number" className="w-full px-1.5 py-1 bg-white text-black border border-gray-400 rounded box-border" value={r.plugPerPiece} onChange={(e) => updateRule(i, { plugPerPiece: Number(e.target.value) })} />
                  </td>
                  <td className="border border-gray-200 px-2 py-1 align-top">
                    <button onClick={() => removeRule(i)} className="px-2.5 py-0.5 bg-white text-red-600 border border-red-200 rounded cursor-pointer text-xs">削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 mt-2.5 items-center">
            <button onClick={addRule} className="px-3.5 py-1 bg-white text-gray-700 border border-gray-300 rounded cursor-pointer text-sm">＋ ルール追加</button>
            <button onClick={clearAllRules} className="px-3.5 py-1 bg-white text-red-600 border border-red-200 rounded cursor-pointer text-sm">全クリア</button>
            <span className="text-xs text-gray-400 ml-1">ルールは自動保存されます（{rules.length}件）</span>
          </div>
        </div>
      )}
    </section>
  );

  return (
    <main className="max-w-[1100px] mx-auto p-6 font-sans bg-white text-black min-h-screen">
      {/* タブバー */}
      <div className="flex border-b-2 border-gray-300 mb-5">
        {([
          ['price', '価格改定ツール', (
            <svg key="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
          )],
          ['stock', '在庫DB編集', (
            <svg key="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
            </svg>
          )],
        ] as [Tab, string, React.ReactNode][]).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-5 py-2 text-sm bg-transparent border-0 border-b-2 -mb-0.5 cursor-pointer ${
              tab === key ? 'font-bold border-[#0070f3] text-[#0070f3]' : 'font-normal border-transparent text-gray-500'
            }`}
          >
            {icon}{label}
          </button>
        ))}
      </div>

      {tab === 'stock' && <StockEditor />}

      {tab === 'price' && (
        <>
          <h1 className="m-0 mb-1.5">価格改定ツール（プロトタイプ）</h1>
          <p className="text-gray-600 mb-3">
            商品名・商品説明・仕様のキーワード一致で「ケーブル単価×長さ＋プラグ単価×個数」を現在価格に加算します。
            処理はすべてブラウザ内で完結します。
          </p>

          {/* プラットフォーム切替 */}
          <div className="flex border-b border-gray-300 mb-0">
            {([['amazon', 'Amazon'], ['shopify', 'Shopify']] as [Platform, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPlatform(key)}
                className={`px-4 py-1.5 text-[13px] border-0 border-b-2 -mb-px cursor-pointer ${
                  platform === key
                    ? key === 'amazon'
                      ? 'font-bold bg-[#FF9900] text-white border-[#FF9900]'
                      : 'font-bold bg-[#95BF47] text-white border-[#95BF47]'
                    : 'font-normal bg-transparent border-transparent text-gray-500'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {platform === 'amazon' && (<>
            <section className="border border-gray-300 rounded-md p-4 mt-4">
              <h2>1. ファイルを選ぶ（複数可・CSV / Excel .xlsx/.xlsm）</h2>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroenabled.12"
                multiple
                onChange={(e) => {
                  setFiles(Array.from(e.target.files ?? []));
                  setData(null); setDiagInfos([]); setError(null); setWarnings([]);
                }}
              />
              <label className="ml-4">
                <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                {' '}Activeのみ対象（xlsm: ステータス「有効」のみ）
              </label>
              {files.length > 0 && (
                <div className="mt-1.5">
                  {files.map((f, i) => (
                    <p key={i} className="text-gray-500 text-[13px] my-0.5">
                      {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)
                    </p>
                  ))}
                </div>
              )}
            </section>

            {rulesSection}

            {error && (
              <div className="text-red-700 mt-4 px-3.5 py-2.5 bg-red-50 border border-red-200 rounded text-sm whitespace-pre-wrap">
                <b>エラー:</b> {error}
              </div>
            )}
            {warnings.length > 0 && (
              <div className="text-amber-700 mt-3 px-3.5 py-2.5 bg-amber-50 border border-amber-300 rounded text-[13px] whitespace-pre-wrap">
                <b>警告（一部ファイルを読み飛ばし）:</b>{'\n'}{warnings.join('\n')}
              </div>
            )}

            {(diagInfos.length > 0 || inventoryMsg !== null) && (
              <section className="border border-gray-300 rounded-md p-4 mt-4">
                <h2>診断パネル（ファイル読み込み詳細）</h2>
                {inventoryMsg !== null && (
                  <div className={`mb-2.5 px-3 py-1.5 rounded text-[13px] border ${inventoryMsg.includes('失敗') ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
                    {inventoryMsg.includes('失敗') ? '❌' : 'ℹ️'} {inventoryMsg}
                  </div>
                )}
                {diagInfos.map((d, i) => (
                  <div key={i} className={`mb-4 px-3.5 py-2.5 rounded text-[13px] border ${d.error ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                    <p className="m-0 mb-1.5 font-bold text-sm">
                      {d.error ? '❌' : '✅'} {d.filename}
                    </p>
                    <table className="border-collapse text-xs">
                      <tbody>
                        <tr>
                          <td className="pr-2.5 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">ワークブック内シート</td>
                          <td className="py-0.5 align-top">
                            {d.sheetNames.length === 0
                              ? '（取得できず）'
                              : d.sheetNames.map((s, j) => (
                                  <span key={j} className={`mr-2 px-1.5 py-px rounded-sm ${s === 'テンプレート' ? 'bg-green-100' : 'bg-gray-200'}`}>{s}</span>
                                ))
                            }
                          </td>
                        </tr>
                        <tr>
                          <td className="pr-2.5 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">「テンプレート」シート</td>
                          <td className="py-0.5 align-top">{d.hasTemplateSheet ? '見つかった ✅' : '見つからなかった ❌'}</td>
                        </tr>
                        <tr>
                          <td className="pr-2.5 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">実データ行数</td>
                          <td className="py-0.5 align-top">{d.dataRowCount.toLocaleString()} 件</td>
                        </tr>
                        <tr>
                          <td className="pr-2.5 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">SKU列</td>
                          <td className="py-0.5 align-top">{d.columns.sku !== null ? `列インデックス ${d.columns.sku} で検出` : '未検出'}</td>
                        </tr>
                        <tr>
                          <td className="pr-2.5 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">商品名列</td>
                          <td className="py-0.5 align-top">{d.columns.name !== null ? `列インデックス ${d.columns.name} で検出` : '未検出'}</td>
                        </tr>
                        <tr>
                          <td className="pr-2.5 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">販売価格列</td>
                          <td className="py-0.5 align-top">{d.columns.price !== null ? `列インデックス ${d.columns.price} で検出` : '未検出'}</td>
                        </tr>
                        <tr>
                          <td className="pr-2.5 py-0.5 font-bold whitespace-nowrap align-top text-gray-600">ステータス列</td>
                          <td className="py-0.5 align-top">{d.columns.status !== null ? `列インデックス ${d.columns.status} で検出` : '未検出'}</td>
                        </tr>
                        {d.error && (
                          <tr>
                            <td className="pr-2.5 py-0.5 font-bold whitespace-nowrap align-top text-red-600">エラー</td>
                            <td className="py-0.5 align-top text-red-600 whitespace-pre-wrap">{d.error}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
              </section>
            )}

            {data && (
              <section className="border border-gray-300 rounded-md p-4 mt-4">
                <h2>4. 結果</h2>
                <p className="mb-3.5">
                  読み込み件数: <b>{data.total.toLocaleString()}</b> 件 ／
                  自動改定: <b className="text-emerald-700">{data.autoCount.toLocaleString()}</b> 件 ／
                  手動対応: <b className="text-amber-700">{data.manualCount.toLocaleString()}</b> 件
                  （自動率 {stats?.rate}%）
                </p>
                {(stats?.cableUnregisteredCount ?? 0) > 0 && (
                  <p className="text-red-600 text-[13px] -mt-2 mb-3.5">
                    ケーブル単価未登録フラグ: <b>{stats!.cableUnregisteredCount.toLocaleString()}</b> 件
                  </p>
                )}
                <div className="flex gap-3 mb-2 flex-wrap">
                  <button onClick={downloadAuto} className="px-5 py-2.5 text-[15px] font-bold bg-emerald-700 text-white border-0 rounded cursor-pointer tracking-wide">
                    自動改定CSVをダウンロード（{data.autoCount}件）
                  </button>
                  <button onClick={downloadManual} className="px-5 py-2.5 text-[15px] font-bold bg-amber-700 text-white border-0 rounded cursor-pointer tracking-wide">
                    手動対応リストCSVをダウンロード（{data.manualCount}件）
                  </button>
                  <button onClick={downloadCheck} className="px-5 py-2.5 text-[15px] font-bold bg-[#1565c0] text-white border-0 rounded cursor-pointer tracking-wide">
                    確認用一覧CSVをダウンロード（全件・根拠つき）
                  </button>
                </div>
                <p className="text-xs text-gray-600 mb-4">
                  先方確認用：元価格と改定後価格、計算根拠（何にマッチしていくら加算したか）の一覧です
                </p>
                <h3 className="mb-2">プレビュー（先頭50件）</h3>
                <div className="overflow-auto max-h-[500px] border border-gray-300">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-100 sticky top-0">
                        <th className="border border-gray-300 px-2 py-1.5 text-left">SKU</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">商品名</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">商品説明</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">商品仕様</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">マッチ</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">長さ(m)</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">個数</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">現価格</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">新価格</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">差額</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">手動理由</th>
                        <th className="border border-gray-300 px-2 py-1.5 text-left">ケーブル単価未登録</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.preview.map((r, i) => (
                        <tr key={i} className={r.newPrice === null ? 'bg-amber-50' : r.cableRateUnregistered ? 'bg-red-50' : ''}>
                          <td className="border border-gray-200 px-2 py-1 align-top">{r.sku}</td>
                          <td className="border border-gray-200 px-2 py-1 align-top" title={r.productName}>{r.productName.slice(0, 40)}{r.productName.length > 40 ? '…' : ''}</td>
                          <td className="border border-gray-200 px-2 py-1 align-top max-w-[200px] truncate" title={r.description}>{r.description.slice(0, 80)}{r.description.length > 80 ? '…' : ''}</td>
                          <td className="border border-gray-200 px-2 py-1 align-top max-w-[200px] truncate" title={r.bulletPoints}>{r.bulletPoints.slice(0, 80)}{r.bulletPoints.length > 80 ? '…' : ''}</td>
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
          </>)}

          {platform === 'shopify' && <ShopifyTool rules={rules} rulesSection={rulesSection} />}

          {platform === 'amazon' && (
            <div className="fixed bottom-6 right-6 z-50">
              <div className="bg-white border border-gray-300 rounded-lg shadow-xl px-5 py-4 flex items-center gap-3">
                <button
                  onClick={onSubmit}
                  disabled={loading}
                  className={`px-7 py-2.5 text-base font-semibold border-0 rounded text-white tracking-wide ${
                    loading ? 'bg-gray-400 cursor-wait' : 'bg-[#0070f3] cursor-pointer'
                  }`}
                >
                  {loading ? '計算中...' : '価格改定を実行'}
                </button>
                <span className="px-3 py-1 text-sm font-bold text-white rounded bg-[#FF9900]">Amazon</span>
              </div>
            </div>
          )}
          <div className="h-24" />
        </>
      )}
    </main>
  );
}

function csvEscape(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function dl(filename: string, content: string) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
