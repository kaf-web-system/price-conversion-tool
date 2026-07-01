import { useMemo, useRef, useState } from 'react';
<<<<<<< HEAD
import { parseFile } from './fileParser';
import type { FileDiagInfo } from './fileParser';
import { calculatePrice } from '../lib/parser';
import type { AmazonRow, CalcResult, KeywordRule } from '../lib/parser';
import { parseRulesTxt } from '../lib/ruleParser';
import StockEditor from './StockEditor';

type Tab = 'price' | 'stock';

type ProcessedData = {
=======
import type { CalcResult, KeywordRule } from '../lib/parser';
import { calculatePrice } from '../lib/parser';
import { parseAmazonCsv, parseRulesCsv, buildRegexFromCode } from '../lib/csv';

type CalcSummary = {
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
  total: number;
  autoCount: number;
  manualCount: number;
  results: CalcResult[];
};

/** プラットフォーム切替（将来のShopify対応のための土台） */
type Platform = 'amazon' | 'shopify';

// DEFAULT_RULES のパターンは buildRegexFromCode で動的生成する。
// これにより lib/csv.ts の改善（半角/全角スペース吸収・ハイフン揺れ吸収・単語境界）が
// DEFAULT_RULES にも自動反映され、`CANARE L-4E6SAT` のような型番違い商品への
// 誤マッチを防げる。
const DEFAULT_RULES: KeywordRule[] = [
<<<<<<< HEAD
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
=======
  { id: '1', label: 'BELDEN 88760', pattern: buildRegexFromCode('BELDEN 88760'), cablePerMeter: 200, plugPerPiece: 300 },
  { id: '2', label: 'MOGAMI 2534', pattern: buildRegexFromCode('MOGAMI 2534'), cablePerMeter: 150, plugPerPiece: 300 },
  { id: '3', label: 'CANARE L-4E6S', pattern: buildRegexFromCode('CANARE L-4E6S'), cablePerMeter: 100, plugPerPiece: 250 },
];

export default function App() {
  const [platform, setPlatform] = useState<Platform>('amazon');
  const [file, setFile] = useState<File | null>(null);
  const [rules, setRules] = useState<KeywordRule[]>(DEFAULT_RULES);
  const [activeOnly, setActiveOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CalcSummary | null>(null);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const rulesFileInputRef = useRef<HTMLInputElement>(null);

  // プレビューのフィルタ・ページング状態（差分プレビュー機能）
  const [previewFilter, setPreviewFilter] = useState<'all' | 'auto' | 'manual'>('auto');
  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048

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

  /** 表示名（型番）から正規表現を自動生成してパターン欄に反映 */
  const autoGenRegex = (i: number) => {
    const target = rules[i];
    if (!target) return;
    const code = target.label.trim();
    if (!code) {
      setError('表示名（型番）を先に入力してください');
      return;
    }
    const pattern = buildRegexFromCode(code);
    updateRule(i, { pattern });
    setError(null);
  };

  /** ルール定義CSV/TXTを読み込み */
  const onRulesFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportInfo(null);
    setImportWarnings([]);
    try {
      const text = await readFileAsText(f);
      const { rules: imported, warnings } = parseRulesCsv(text);
      if (imported.length === 0) {
        setImportInfo(`「${f.name}」からルールを読み込めませんでした`);
        setImportWarnings(warnings);
        return;
      }
      // 上書き方式（既存ルールを置き換え）。マージ希望時は後述ボタン分岐。
      setRules(imported);
      setImportInfo(`「${f.name}」から ${imported.length} 件のルールを読み込みました（既存ルールは置き換え）`);
      setImportWarnings(warnings);
    } catch (err) {
      setImportInfo(`読み込みエラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // 同じファイルを再選択できるようにリセット
      if (rulesFileInputRef.current) rulesFileInputRef.current.value = '';
    }
  };

  /** ルール定義CSV/TXTを読み込み（既存にマージ） */
  const onRulesFileMerge = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImportInfo(null);
    setImportWarnings([]);
    try {
      const text = await readFileAsText(f);
      const { rules: imported, warnings } = parseRulesCsv(text);
      if (imported.length === 0) {
        setImportInfo(`「${f.name}」からルールを読み込めませんでした`);
        setImportWarnings(warnings);
        return;
      }
      setRules((rs) => [...rs, ...imported]);
      setImportInfo(`「${f.name}」から ${imported.length} 件のルールを既存に追加しました`);
      setImportWarnings(warnings);
    } catch (err) {
      setImportInfo(`読み込みエラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      (e.target as HTMLInputElement).value = '';
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
<<<<<<< HEAD
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
=======
      // ファイル → ArrayBuffer → Uint8Array
      const buffer = await file.arrayBuffer();
      const rows = parseAmazonCsv(new Uint8Array(buffer), { activeOnly });

      // 計算
      const results: CalcResult[] = rows.map((r) => calculatePrice(r, rules));
      const auto = results.filter((r) => r.newPrice !== null);
      const manual = results.filter((r) => r.newPrice === null);

      setData({
        total: rows.length,
        autoCount: auto.length,
        manualCount: manual.length,
        results,
      });
      // 再計算時はプレビューの表示状態を初期化（page/pageInput/previewFilter）
      // pageSize はユーザーの選択を尊重して保持
      setPage(1);
      setPageInput('1');
      setPreviewFilter('auto');
    } catch (e) {
      setError(e instanceof Error ? e.message : '処理エラー');
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
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

  // 詳細CSV（検証用・全カラム）ダウンロード
  const downloadDetail = () => {
    if (!data) return;
    const lines = ['sku,商品名,現価格,改定後価格,差額,マッチしたルール,分類'];
    for (const r of data.results) {
      const klass = r.newPrice === null ? `手動対応: ${r.manualReason ?? ''}` : '自動改定';
      const newP = r.newPrice !== null ? String(r.newPrice) : '';
      const diff = r.diff !== null ? (r.diff >= 0 ? `+${r.diff}` : String(r.diff)) : '';
      const rule = r.matchedRuleLabel ?? '';
      lines.push(
        `${csvEscape(r.sku)},${csvEscape(r.productName)},${r.currentPrice},${newP},${csvEscape(diff)},${csvEscape(rule)},${csvEscape(klass)}`
      );
    }
    download('amazon_price_detail.csv', lines.join('\n'));
  };

  // フィルタ済みプレビューリスト
  const filteredResults = useMemo(() => {
    if (!data) return [] as CalcResult[];
    if (previewFilter === 'auto') return data.results.filter((r) => r.newPrice !== null);
    if (previewFilter === 'manual') return data.results.filter((r) => r.newPrice === null);
    return data.results;
  }, [data, previewFilter]);

  // pageSize === 0 は「全件」表示のセンチネル値
  const showAll = pageSize === 0;
  const totalPages = showAll ? 1 : Math.max(1, Math.ceil(filteredResults.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageStart = showAll ? 0 : (currentPage - 1) * pageSize;
  const pageRows = showAll ? filteredResults : filteredResults.slice(pageStart, pageStart + pageSize);
  const pageEnd = showAll ? filteredResults.length : Math.min(pageStart + pageSize, filteredResults.length);

  // フィルタ・ページサイズが変わった時はページ1へ戻す
  const changeFilter = (f: 'all' | 'auto' | 'manual') => {
    setPreviewFilter(f);
    setPage(1);
    setPageInput('1');
  };
  const changePageSize = (n: number) => {
    setPageSize(n);
    setPage(1);
    setPageInput('1');
  };
  const goToPage = (n: number) => {
    const clamped = Math.min(Math.max(1, n), totalPages);
    setPage(clamped);
    setPageInput(String(clamped));
  };

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: 'sans-serif', background: '#fff', color: '#000', minHeight: '100vh' }}>
<<<<<<< HEAD
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
=======
      <h1>価格改定ツール</h1>

      <p style={{ color: '#555' }}>
        商品名のキーワード一致で「ケーブル単価×長さ×本数＋プラグ単価×個数」を現在価格に加算します。
        <br />
        <span style={{ fontSize: 12, color: '#888' }}>
          ※ CSVはブラウザ内で処理されるため、サーバーへ送信されません（大容量ファイル対応）。
        </span>
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
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

        <div style={{ background: '#f7fbff', border: '1px solid #cfe2f3', borderRadius: 4, padding: 12, margin: '8px 0' }}>
          <strong>ルール定義ファイルを一括インポート</strong>
          <p style={{ fontSize: 12, color: '#555', margin: '6px 0' }}>
            「値上げデータ.txt」のような<code>型番 単価</code>形式や、<code>型番,1m単価,プラグ単価</code>のCSV形式に対応。
            「ケーブル」「プラグ」のセクション見出しも自動判別します。
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={btnLike}>
              既存を置き換えてインポート
              <input
                ref={rulesFileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={onRulesFileChange}
                style={{ display: 'none' }}
              />
            </label>
            <label style={btnLikeAlt}>
              既存に追加（マージ）
              <input
                type="file"
                accept=".csv,.txt"
                onChange={onRulesFileMerge}
                style={{ display: 'none' }}
              />
            </label>
          </div>
          {importInfo && (
            <p style={{ fontSize: 12, color: '#080', margin: '8px 0 0' }}>{importInfo}</p>
          )}
          {importWarnings.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 12, color: '#c80', cursor: 'pointer' }}>
                警告 {importWarnings.length} 件
              </summary>
              <ul style={{ fontSize: 12, color: '#c80', margin: '6px 0 0 16px' }}>
                {importWarnings.slice(0, 20).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {importWarnings.length > 20 && <li>...ほか {importWarnings.length - 20} 件</li>}
              </ul>
            </details>
          )}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={th}>表示名（型番）</th>
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
<<<<<<< HEAD
                  <input style={inp} value={r.pattern} onChange={(e) => updateRule(i, { pattern: e.target.value })} />
=======
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      style={inp}
                      value={r.pattern}
                      onChange={(e) => updateRule(i, { pattern: e.target.value })}
                      placeholder="例: BELDEN\s*88760"
                    />
                    <button
                      onClick={() => autoGenRegex(i)}
                      title="表示名から正規表現を自動生成"
                      style={{ whiteSpace: 'nowrap', padding: '0 8px', fontSize: 12 }}
                    >
                      自動生成
                    </button>
                  </div>
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
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
        <h2>3. プラットフォームを選択</h2>
        <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #ddd', flexWrap: 'wrap' }}>
          <button
            onClick={() => setPlatform('amazon')}
            style={platform === 'amazon' ? tabActive : tabInactive}
          >
            Amazon
          </button>
          <button
            onClick={() => setPlatform('shopify')}
            style={platform === 'shopify' ? tabActive : tabInactive}
          >
            Shopify（準備中）
          </button>
        </div>
        {platform === 'shopify' && (
          <p style={{ color: '#555', fontSize: 14, marginTop: 12, marginBottom: 0 }}>
            Shopify対応は準備中です。Amazonをお選びください。
          </p>
        )}
      </section>

      {platform === 'amazon' && (
      <>
      <section style={card}>
        <h2>4. 実行</h2>
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
          <h2>5. 結果</h2>
          <p>
            読み込み件数: <b>{data.total.toLocaleString()}</b> 件 ／
            自動改定: <b style={{ color: '#080' }}>{data.autoCount.toLocaleString()}</b> 件 ／
            手動対応: <b style={{ color: '#c80' }}>{data.manualCount.toLocaleString()}</b> 件
            （自動率 {stats?.rate}%）
          </p>
<<<<<<< HEAD
          {(stats?.cableUnregisteredCount ?? 0) > 0 && (
            <p style={{ color: '#c00', fontSize: 13, margin: '4px 0' }}>
              ケーブル単価未登録フラグ: <b>{stats!.cableUnregisteredCount.toLocaleString()}</b> 件
            </p>
          )}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <button onClick={downloadAuto}>自動改定CSVをダウンロード</button>
            <button onClick={downloadManual}>手動対応リストCSVをダウンロード</button>
=======
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={downloadAuto}>自動改定CSV（Amazon仕様）</button>
            <button onClick={downloadManual}>手動対応リストCSV</button>
            <button onClick={downloadDetail} style={{ background: '#f7fbff', border: '1px solid #0070f3', color: '#0070f3' }}>
              詳細CSV（検証用・全カラム）
            </button>
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
          </div>

          {/* フィルタタブ */}
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => changeFilter('all')}
              style={previewFilter === 'all' ? filterTabActive : filterTabInactive}
            >
              全件（{data.total.toLocaleString()}件）
            </button>
            <button
              onClick={() => changeFilter('auto')}
              style={previewFilter === 'auto' ? filterTabActive : filterTabInactive}
            >
              自動改定対象のみ（{data.autoCount.toLocaleString()}件）
            </button>
            <button
              onClick={() => changeFilter('manual')}
              style={previewFilter === 'manual' ? filterTabActive : filterTabInactive}
            >
              手動対応のみ（{data.manualCount.toLocaleString()}件）
            </button>
          </div>

          {/* ページサイズ・ページャ */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap', fontSize: 13 }}>
            <label>
              表示件数:{' '}
              <select value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value={500}>500</option>
                <option value={0}>全件</option>
              </select>
              {' '}{showAll ? '' : '件/ページ'}
            </label>
            <span style={{ color: '#666' }}>
              {filteredResults.length === 0
                ? '0件'
                : `${(pageStart + 1).toLocaleString()}〜${pageEnd.toLocaleString()} / ${filteredResults.length.toLocaleString()}件`}
            </span>
            {!showAll && (
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>← 前</button>
                <input
                  type="number"
                  inputMode="numeric"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => {
                    // 空文字・NaN・負値は現在のページに戻して正規化
                    const n = Number(pageInput);
                    if (!pageInput.trim() || Number.isNaN(n)) {
                      goToPage(currentPage);
                    } else {
                      goToPage(n);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const n = Number(pageInput);
                      if (!pageInput.trim() || Number.isNaN(n)) {
                        goToPage(currentPage);
                      } else {
                        goToPage(n);
                      }
                    }
                  }}
                  style={{ width: 60, textAlign: 'center', padding: 4 }}
                />
                <span style={{ color: '#666' }}>/ {totalPages.toLocaleString()}</span>
                <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>次 →</button>
              </span>
            )}
          </div>

          <h3 style={{ marginBottom: 6 }}>
            プレビュー（{previewFilter === 'all' ? '全件' : previewFilter === 'auto' ? '自動改定対象のみ' : '手動対応のみ'}）
          </h3>
          <div style={{ overflow: 'auto', maxHeight: 600, border: '1px solid #ddd' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 900 }}>
              <thead>
<<<<<<< HEAD
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
=======
                <tr>
                  <th style={thSticky}>SKU</th>
                  <th style={thSticky}>商品名</th>
                  <th style={{ ...thSticky, textAlign: 'right' }}>現価格</th>
                  <th style={{ ...thSticky, textAlign: 'right' }}>改定後価格</th>
                  <th style={{ ...thSticky, textAlign: 'right' }}>差額</th>
                  <th style={thSticky}>マッチしたルール / 手動対応理由</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => {
                  const isManual = r.newPrice === null;
                  return (
                    <tr key={pageStart + i} style={{ background: isManual ? '#fff8e1' : 'transparent' }}>
                      <td style={td}>{r.sku}</td>
                      <td style={td} title={r.productName}>
                        {r.productName.slice(0, 50)}
                        {r.productName.length > 50 ? '…' : ''}
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{r.currentPrice.toLocaleString()}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {isManual ? '' : r.newPrice!.toLocaleString()}
                      </td>
                      <td style={{ ...td, textAlign: 'right', color: isManual ? '#999' : (r.diff! >= 0 ? '#080' : '#c00'), fontWeight: 600 }}>
                        {isManual
                          ? ''
                          : (r.diff! >= 0 ? `+${r.diff!.toLocaleString()}` : r.diff!.toLocaleString())}
                      </td>
                      <td style={td}>
                        {isManual ? (
                          <span style={{ color: '#c80' }}>
                            手動対応: {r.manualReason ?? '-'}
                            {r.matchedRuleLabel ? `（${r.matchedRuleLabel}）` : ''}
                          </span>
                        ) : (
                          r.matchedRuleLabel ?? '-'
                        )}
                      </td>
                    </tr>
                  );
                })}
                {pageRows.length === 0 && (
                  <tr>
                    <td style={td} colSpan={6}>
                      <span style={{ color: '#999' }}>表示できる行がありません</span>
                    </td>
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
                  </tr>
                )}
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
// iOS Safari 等で確実に効く sticky ヘッダ（th 自身に position:sticky を当てる）
const thSticky: React.CSSProperties = {
  border: '1px solid #ddd',
  padding: '6px 8px',
  textAlign: 'left',
  position: 'sticky',
  top: 0,
  background: '#f0f0f0',
  zIndex: 1,
};
const td: React.CSSProperties = { border: '1px solid #eee', padding: '4px 8px', verticalAlign: 'top' };
const tdClamp: React.CSSProperties = { border: '1px solid #eee', padding: '4px 8px', verticalAlign: 'top', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const inp: React.CSSProperties = { width: '100%', padding: 6, boxSizing: 'border-box', background: '#fff', color: '#000', border: '1px solid #bbb', borderRadius: 3 };
<<<<<<< HEAD
const diagTh: React.CSSProperties = { padding: '3px 10px 3px 0', fontWeight: 'bold', whiteSpace: 'nowrap', verticalAlign: 'top', color: '#444' };
const diagTd: React.CSSProperties = { padding: '3px 0', verticalAlign: 'top' };
=======
const btnLike: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 14px',
  background: '#0070f3',
  color: '#fff',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};
const btnLikeAlt: React.CSSProperties = {
  display: 'inline-block',
  padding: '6px 14px',
  background: '#fff',
  color: '#0070f3',
  border: '1px solid #0070f3',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const tabBase: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  border: 'none',
  borderTopLeftRadius: 6,
  borderTopRightRadius: 6,
  cursor: 'pointer',
  marginBottom: -2,
};
const tabActive: React.CSSProperties = {
  ...tabBase,
  background: '#0070f3',
  color: '#fff',
  fontWeight: 600,
  borderBottom: '2px solid #0070f3',
};
const tabInactive: React.CSSProperties = {
  ...tabBase,
  background: '#f0f0f0',
  color: '#555',
};

const filterTabBase: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
};
const filterTabActive: React.CSSProperties = {
  ...filterTabBase,
  background: '#0070f3',
  color: '#fff',
  borderColor: '#0070f3',
  fontWeight: 600,
};
const filterTabInactive: React.CSSProperties = {
  ...filterTabBase,
  background: '#fff',
  color: '#333',
};
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048

function csvEscape(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(filename: string, content: string) {
<<<<<<< HEAD
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
=======
  // BOM付きUTF-8でExcel互換
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** File → テキスト読込（UTF-8/Shift-JIS自動判定） */
async function readFileAsText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // UTF-8 BOMがあればUTF-8確定
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.slice(3));
  }
  // まずUTF-8でデコードしてみて、文字化けっぽければShift-JISへ
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return utf8;
  } catch {
    return new TextDecoder('shift-jis', { fatal: false }).decode(bytes);
  }
}
