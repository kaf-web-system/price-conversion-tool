import { useMemo, useRef, useState } from 'react';
import type { CalcResult, KeywordRule } from '../lib/parser';
import { calculatePrice } from '../lib/parser';
import { parseAmazonCsv, parseRulesCsv, buildRegexFromCode } from '../lib/csv';

type CalcSummary = {
  total: number;
  autoCount: number;
  manualCount: number;
  results: CalcResult[];
};

/** プラットフォーム切替（将来のShopify対応のための土台） */
type Platform = 'amazon' | 'shopify';

const DEFAULT_RULES: KeywordRule[] = [
  { id: '1', label: 'BELDEN 88760', pattern: 'BELDEN\\s*88760', cablePerMeter: 200, plugPerPiece: 300 },
  { id: '2', label: 'MOGAMI 2534', pattern: 'MOGAMI\\s*2534', cablePerMeter: 150, plugPerPiece: 300 },
  { id: '3', label: 'CANARE L-4E6S', pattern: 'CANARE\\s*L-?4E6S', cablePerMeter: 100, plugPerPiece: 250 },
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
    if (!file) {
      setError('CSVファイルを選んでください');
      return;
    }
    setError(null);
    setLoading(true);
    setData(null);

    try {
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
      <h1>価格改定ツール</h1>

      {/* プラットフォーム切替タブ（土台のみ・Shopifyは準備中） */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #ddd', marginBottom: 16, flexWrap: 'wrap' }}>
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
        <section style={{ ...card, background: '#fafafa' }}>
          <h2 style={{ marginTop: 0 }}>Shopify対応は準備中です</h2>
          <p style={{ color: '#555', fontSize: 14 }}>
            Amazonと同じルール定義を使ってShopify側の価格も一括改定できるよう、次のフェーズで対応予定です。
            <br />
            画面上部の「Amazon」タブから現在の機能が利用できます。
          </p>
        </section>
      )}

      {platform === 'amazon' && (
      <>
      <p style={{ color: '#555' }}>
        商品名のキーワード一致で「ケーブル単価×長さ×本数＋プラグ単価×個数」を現在価格に加算します。
        <br />
        <span style={{ fontSize: 12, color: '#888' }}>
          ※ CSVはブラウザ内で処理されるため、サーバーへ送信されません（大容量ファイル対応）。
        </span>
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
                  <input
                    style={inp}
                    value={r.label}
                    onChange={(e) => updateRule(i, { label: e.target.value })}
                  />
                </td>
                <td style={td}>
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
          <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <button onClick={downloadAuto}>自動改定CSV（Amazon仕様）</button>
            <button onClick={downloadManual}>手動対応リストCSV</button>
            <button onClick={downloadDetail} style={{ background: '#f7fbff', border: '1px solid #0070f3', color: '#0070f3' }}>
              詳細CSV（検証用・全カラム）
            </button>
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

const card: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 16,
  marginTop: 16,
};
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
const inp: React.CSSProperties = { width: '100%', padding: 6, boxSizing: 'border-box', background: '#fff', color: '#000', border: '1px solid #bbb', borderRadius: 3 };
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

function csvEscape(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function download(filename: string, content: string) {
  // BOM付きUTF-8でExcel互換
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
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
