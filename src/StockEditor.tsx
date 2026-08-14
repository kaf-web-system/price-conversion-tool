import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseFile } from './fileParser';
import { collectStockUpsertRows, toUpsertBatches } from '../lib/stockImport';
import { DEFAULT_STOCK_SORT, buildStockOrder, nextStockSort, sortStockRows } from '../lib/stockSort';
import type { StockSortKey, StockSortState } from '../lib/stockSort';
import type { AmazonRow } from '../lib/parser';

type StockRow = {
  id: string;
  sku: string;
  item_name: string | null;
  plug_name: string | null;
  current_price: number | null;
  updated_at: string;
  created_at: string;
};

type DraftRow = { sku: string; item_name: string; plug_name: string; current_price: string };

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const headers = {
  'Content-Type': 'application/json',
  apikey: supabaseKey,
  Authorization: `Bearer ${supabaseKey}`,
  Prefer: 'return=representation',
};

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const resp = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text}`);
  }
  return resp;
}

const EMPTY_DRAFT: DraftRow = { sku: '', item_name: '', plug_name: '', current_price: '' };
const PAGE_SIZE = 100;
const CHUNK_SIZE = 1000;

export default function StockEditor() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState<DraftRow>(EMPTY_DRAFT);

  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow>(EMPTY_DRAFT);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<StockSortState>(DEFAULT_STOCK_SORT);

  const notify = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  // Build the base query path with optional search filter
  // ソート状態に合わせてサーバー側の並び（チャンク取得の順序）も揃える
  const buildQuery = (searchTerm: string, sortState: StockSortState): string => {
    const select = `select=id,sku,item_name,plug_name,current_price,updated_at,created_at&${buildStockOrder(sortState)}`;
    if (!searchTerm.trim()) return `stock?${select}`;
    const q = encodeURIComponent(`%${searchTerm.trim()}%`);
    return `stock?or=(sku.ilike.${q},item_name.ilike.${q},plug_name.ilike.${q})&${select}`;
  };

  // Fetch total count using Prefer: count=exact with a 0-row range
  const fetchCount = useCallback(async (searchTerm: string): Promise<number> => {
    const path = buildQuery(searchTerm, sort);
    const resp = await apiFetch(`${path}&offset=0&limit=1`, {
      headers: { Prefer: 'count=exact' },
    });
    const range = resp.headers.get('content-range');
    if (range) {
      const parts = range.split('/');
      if (parts.length === 2) return parseInt(parts[1], 10) || 0;
    }
    return 0;
  }, [sort]);

  // Fetch a chunk of rows from offset
  const fetchChunk = useCallback(async (searchTerm: string, offset: number, limit: number): Promise<StockRow[]> => {
    const path = buildQuery(searchTerm, sort);
    const resp = await apiFetch(`${path}&offset=${offset}&limit=${limit}`, {
      headers: { Prefer: 'count=exact' },
    });
    return await resp.json();
  }, [sort]);

  // Initial load: get count + first chunk
  const loadData = useCallback(async (searchTerm: string) => {
    setLoading(true);
    setError(null);
    try {
      const count = await fetchCount(searchTerm);
      setTotalCount(count);
      const firstChunk = await fetchChunk(searchTerm, 0, CHUNK_SIZE);
      setRows(firstChunk);
      setLoadedCount(firstChunk.length);
      setPage(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      setTotalCount(0);
      setLoadedCount(0);
    } finally {
      setLoading(false);
    }
  }, [fetchCount, fetchChunk]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  // Reload data when debounced search changes
  useEffect(() => {
    loadData(debouncedSearch);
  }, [debouncedSearch, loadData]);

  // Fetch next chunk when the current page goes beyond loaded rows
  const ensureChunkLoaded = useCallback(async (searchTerm: string, neededRowCount: number) => {
    if (neededRowCount <= loadedCount) return;
    if (loadedCount >= totalCount) return;
    setFetchingMore(true);
    try {
      const nextChunk = await fetchChunk(searchTerm, loadedCount, CHUNK_SIZE);
      if (nextChunk.length > 0) {
        setRows((prev) => [...prev, ...nextChunk]);
        setLoadedCount((prev) => prev + nextChunk.length);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingMore(false);
    }
  }, [loadedCount, totalCount, fetchChunk]);

  const handleAdd = async () => {
    const sku = draft.sku.trim();
    const item_name = draft.item_name.trim();
    const plug_name = draft.plug_name.trim();
    if (!sku) { setError('SKU は必須です'); return; }
    const priceNum = draft.current_price.trim() === '' ? null : parseInt(draft.current_price.replace(/,/g, ''), 10);
    if (priceNum !== null && isNaN(priceNum)) { setError('現在価格が数値として読み取れません'); return; }
    setError(null);
    try {
      await apiFetch('stock', {
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify({ sku, item_name: item_name || null, plug_name: plug_name || null, current_price: priceNum, updated_at: new Date().toISOString() }),
      });
      setDraft(EMPTY_DRAFT);
      notify('追加しました');
      await loadData(debouncedSearch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startEdit = (row: StockRow) => {
    setEditId(row.id);
    setEditDraft({ sku: row.sku, item_name: row.item_name ?? '', plug_name: row.plug_name ?? '', current_price: row.current_price != null ? String(row.current_price) : '' });
  };

  const cancelEdit = () => { setEditId(null); setEditDraft(EMPTY_DRAFT); };

  const handleSave = async (id: string) => {
    const sku = editDraft.sku.trim();
    const item_name = editDraft.item_name.trim();
    const plug_name = editDraft.plug_name.trim();
    if (!sku) { setError('SKU は必須です'); return; }
    const priceNum = editDraft.current_price.trim() === '' ? null : parseInt(editDraft.current_price.replace(/,/g, ''), 10);
    if (priceNum !== null && isNaN(priceNum)) { setError('現在価格が数値として読み取れません'); return; }
    setError(null);
    try {
      await apiFetch(`stock?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sku, item_name: item_name || null, plug_name: plug_name || null, current_price: priceNum, updated_at: new Date().toISOString() }),
      });
      cancelEdit();
      notify('更新しました');
      await loadData(debouncedSearch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (id: string, sku: string) => {
    if (!window.confirm(`SKU「${sku}」を削除しますか？`)) return;
    setError(null);
    try {
      await apiFetch(`stock?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: '' } });
      notify('削除しました');
      await loadData(debouncedSearch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setImportBusy(true);
    setImportError(null);
    setImportMsg(null);
    setError(null);
    try {
      const allParsed: AmazonRow[] = [];
      const fileErrors: string[] = [];
      let totalParsed = 0;

      for (const file of files) {
        const { rows: parsed, diag } = await parseFile(file, { activeOnly: false });
        if (diag.error) { fileErrors.push(`${file.name}: ${diag.error}`); continue; }
        totalParsed += parsed.length;
        allParsed.push(...parsed);
      }

      if (fileErrors.length > 0 && totalParsed === 0) {
        setImportError(`すべてのファイルの読み込みに失敗しました:\n${fileErrors.join('\n')}`);
        return;
      }

      const { rows: upsertRows, noSkuCount, noPriceCount } = collectStockUpsertRows(allParsed);
      if (upsertRows.length === 0) { setImportError('SKU が取得できる行がありませんでした。'); return; }

      // 商品名が取れない行（旧形式）は item_name を送らず既存値を保持する（後方互換）
      const batches = toUpsertBatches(upsertRows, new Date().toISOString());
      let insertedCount = 0;
      for (const batch of batches) {
        const resp = await apiFetch('stock', {
          method: 'POST',
          headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
          body: JSON.stringify(batch),
        });
        const inserted = await resp.json() as StockRow[];
        insertedCount += inserted.length;
      }
      await loadData(debouncedSearch);
      const parts = [`${insertedCount} 件を取り込みました（${files.length} ファイル・${upsertRows.length} SKU）`];
      if (fileErrors.length > 0) parts.push(`読み込み失敗: ${fileErrors.length} 件`);
      if (noSkuCount > 0) parts.push(`SKU空: ${noSkuCount} 件スキップ`);
      if (noPriceCount > 0) parts.push(`価格空または0: ${noPriceCount} 件は価格未設定で登録`);
      setImportMsg(parts.join(' / '));
      if (fileErrors.length > 0) setImportError(`一部ファイル読み込み失敗:\n${fileErrors.join('\n')}`);
    } catch (err) {
      setImportError(`インポートエラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImportBusy(false);
    }
  };

  // 列タイトルクリック: 同じ列は昇順⇔降順トグル、別の列はその列の昇順（片方は解除）
  const handleSortClick = (key: StockSortKey) => setSort((s) => nextStockSort(s, key));

  // 読み込み済み行を表示用に安定ソート（日本語商品名は localeCompare('ja')）
  const sortedRows = useMemo(() => sortStockRows(rows, sort), [rows, sort]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = sortedRows.slice(pageStart, pageStart + PAGE_SIZE);

  // When page changes, check if we need to fetch more data
  useEffect(() => {
    const needed = pageStart + PAGE_SIZE;
    if (needed > loadedCount && loadedCount < totalCount && !loading && !fetchingMore) {
      ensureChunkLoaded(debouncedSearch, needed);
    }
  }, [pageStart, loadedCount, totalCount, loading, fetchingMore, ensureChunkLoaded, debouncedSearch]);

  const pageNumbers: number[] = [];
  const maxButtons = 7;
  let startPage = Math.max(1, currentPage - 3);
  const endPage = Math.min(totalPages, startPage + maxButtons - 1);
  startPage = Math.max(1, endPage - maxButtons + 1);
  for (let p = startPage; p <= endPage; p++) pageNumbers.push(p);

  return (
    <div className="mx-auto px-6 py-6 font-sans text-black" style={{ maxWidth: '100vw' }}>
      <h2 className="mt-0">在庫DB（stock）編集</h2>
      <p className="text-gray-600 text-[13px] mb-4">
        SKU と 商品名（item_name）、プラグ型番（plug_name）、現在価格（current_price）の対応を管理します。
        ここで登録した plug_name が価格改定ツールのプラグ判定に使われます。
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded px-3 py-2 mb-3 text-[13px]">
          <b>エラー:</b> {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-300 text-green-700 rounded px-3 py-2 mb-3 text-[13px]">
          {success}
        </div>
      )}

      {/* ファイルインポート */}
      <div className="border border-gray-300 rounded p-3 mb-5">
        <h3 className="m-0 mb-2.5 text-sm">ファイルから一括取り込み（CSV / Excel .xlsx/.xlsm）</h3>
        <p className="text-gray-500 text-[12px] mb-2">
          Amazon用CSV・Excelファイルを読み込み、SKU をキーに stock テーブルへ登録・更新します。
          商品名を item_name に、現在価格（販売価格 JPY）を current_price にセットします。同一 SKU が既にある場合は商品名・価格を更新します
          （商品名列が無い旧形式ファイルは従来どおり価格のみ更新し、登録済みの商品名は保持します）。
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.xlsm,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroenabled.12"
            onChange={handleImport}
            disabled={importBusy}
            multiple
            className="text-[13px]"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importBusy}
            className="px-4 py-1.5 bg-[#0070f3] text-white border-0 rounded cursor-pointer text-[13px] disabled:opacity-50"
          >
            {importBusy ? '取り込み中...' : 'ファイルを選択して取り込む（複数可）'}
          </button>
        </div>
        {importError && (
          <div className="mt-2 bg-red-50 border border-red-200 text-red-600 rounded px-3 py-2 text-[13px]">
            {importError}
          </div>
        )}
        {importMsg && (
          <div className="mt-2 bg-green-50 border border-green-300 text-green-700 rounded px-3 py-2 text-[13px]">
            {importMsg}
          </div>
        )}
      </div>

      {/* 新規追加フォーム */}
      <div className="border border-gray-300 rounded p-3 mb-5">
        <h3 className="m-0 mb-2.5 text-sm">新規追加</h3>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            placeholder="SKU（必須）"
            value={draft.sku}
            onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black min-w-[160px] box-border"
          />
          <input
            placeholder="商品名 / item_name"
            value={draft.item_name}
            onChange={(e) => setDraft((d) => ({ ...d, item_name: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black min-w-[260px] box-border"
          />
          <input
            placeholder="プラグ型番 / plug_name"
            value={draft.plug_name}
            onChange={(e) => setDraft((d) => ({ ...d, plug_name: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black min-w-[220px] box-border"
          />
          <input
            placeholder="現在価格（円）"
            value={draft.current_price}
            onChange={(e) => setDraft((d) => ({ ...d, current_price: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black min-w-[120px] box-border"
          />
          <button onClick={handleAdd} className="px-4 py-1.5 bg-[#0070f3] text-white border-0 rounded cursor-pointer text-[13px]">追加</button>
        </div>
      </div>

      {/* 検索ボックス */}
      <div className="mb-2.5">
        <input
          placeholder="SKU / 商品名 / plug_name で絞り込み（部分一致・サーバー検索）"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black min-w-[300px] max-w-[400px] box-border"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="ml-2 px-2.5 py-1 text-xs cursor-pointer border border-gray-300 rounded bg-white text-gray-600"
          >
            クリア
          </button>
        )}
      </div>

      {/* 一覧テーブル */}
      <div className="border border-gray-300 rounded overflow-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-2.5 py-1.5 text-left font-semibold">SKU</th>
              <th className="border border-gray-300 p-0 text-left font-semibold">
                <button
                  onClick={() => handleSortClick('item_name')}
                  title="クリックで商品名の昇順／降順を切り替え"
                  className="w-full flex items-center gap-1 px-2.5 py-1.5 bg-transparent border-0 cursor-pointer font-semibold text-[13px] text-left hover:bg-gray-200"
                >
                  商品名
                  <span className={sort.key === 'item_name' ? 'text-[#0070f3]' : 'text-gray-400'}>
                    {sort.key === 'item_name' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </button>
              </th>
              <th className="border border-gray-300 px-2.5 py-1.5 text-left font-semibold">plug_name</th>
              <th className="border border-gray-300 p-0 text-right font-semibold">
                <button
                  onClick={() => handleSortClick('current_price')}
                  title="クリックで価格の昇順／降順を切り替え"
                  className="w-full flex items-center justify-end gap-1 px-2.5 py-1.5 bg-transparent border-0 cursor-pointer font-semibold text-[13px] text-right hover:bg-gray-200"
                >
                  現在価格
                  <span className={sort.key === 'current_price' ? 'text-[#0070f3]' : 'text-gray-400'}>
                    {sort.key === 'current_price' ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </button>
              </th>
              <th className="border border-gray-300 px-2.5 py-1.5 text-left font-semibold">更新日時</th>
              <th className="border border-gray-300 px-2.5 py-1.5 text-left font-semibold">登録日時</th>
              <th className="border border-gray-300 px-2.5 py-1.5 text-left font-semibold w-[120px]">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="p-4 text-center text-gray-500">読み込み中...</td></tr>
            )}
            {!loading && totalCount === 0 && (
              <tr><td colSpan={7} className="p-4 text-center text-gray-500">データがありません</td></tr>
            )}
            {pageRows.map((row) =>
              editId === row.id ? (
                <tr key={row.id} className="bg-yellow-50">
                  <td className="px-2.5 py-1.5 align-middle">
                    <input
                      value={editDraft.sku}
                      onChange={(e) => setEditDraft((d) => ({ ...d, sku: e.target.value }))}
                      className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black w-full box-border"
                    />
                  </td>
                  <td className="px-2.5 py-1.5 align-middle">
                    <input
                      value={editDraft.item_name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, item_name: e.target.value }))}
                      className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black w-full box-border"
                    />
                  </td>
                  <td className="px-2.5 py-1.5 align-middle">
                    <input
                      value={editDraft.plug_name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, plug_name: e.target.value }))}
                      className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black w-full box-border"
                    />
                  </td>
                  <td className="px-2.5 py-1.5 align-middle">
                    <input
                      value={editDraft.current_price}
                      onChange={(e) => setEditDraft((d) => ({ ...d, current_price: e.target.value }))}
                      className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black w-full box-border text-right"
                    />
                  </td>
                  <td className="px-2.5 py-1.5 align-middle text-gray-400 text-[11px]">{formatDate(row.updated_at)}</td>
                  <td className="px-2.5 py-1.5 align-middle text-gray-300 text-[11px]">{formatDate(row.created_at)}</td>
                  <td className="px-2.5 py-1.5 align-middle">
                    <button onClick={() => handleSave(row.id)} className="px-2.5 py-0.5 bg-[#0070f3] text-white border-0 rounded cursor-pointer text-xs mr-1">保存</button>
                    <button onClick={cancelEdit} className="px-2.5 py-0.5 bg-white text-gray-700 border border-gray-300 rounded cursor-pointer text-xs">取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} className="border-t border-gray-200">
                  <td className="px-2.5 py-1.5 align-middle">{row.sku}</td>
                  <td className={`px-2.5 py-1.5 align-middle max-w-[320px] ${row.item_name ? 'text-black' : 'text-gray-300'}`} title={row.item_name ?? ''}>
                    {row.item_name ?? '（未設定）'}
                  </td>
                  <td className={`px-2.5 py-1.5 align-middle ${row.plug_name ? 'text-black' : 'text-gray-300'}`}>{row.plug_name ?? '（未設定）'}</td>
                  <td className={`px-2.5 py-1.5 align-middle text-right ${row.current_price != null ? 'text-black' : 'text-gray-300'}`}>
                    {row.current_price != null ? row.current_price.toLocaleString() : '（未設定）'}
                  </td>
                  <td className="px-2.5 py-1.5 align-middle text-gray-500 text-[11px]">{formatDate(row.updated_at)}</td>
                  <td className="px-2.5 py-1.5 align-middle text-gray-500 text-[11px]">{formatDate(row.created_at)}</td>
                  <td className="px-2.5 py-1.5 align-middle">
                    <button onClick={() => startEdit(row)} className="px-2.5 py-0.5 bg-white text-gray-700 border border-gray-300 rounded cursor-pointer text-xs mr-1">編集</button>
                    <button onClick={() => handleDelete(row.id, row.sku)} className="px-2.5 py-0.5 bg-white text-red-600 border border-red-200 rounded cursor-pointer text-xs">削除</button>
                  </td>
                </tr>
              )
            )}
            {fetchingMore && (
              <tr><td colSpan={7} className="p-2 text-center text-gray-400 text-[12px]">追加データを読み込み中...</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        {search
          ? `検索結果: ${totalCount} 件（読み込み済み ${loadedCount} 件）`
          : `合計 ${totalCount} 件（読み込み済み ${loadedCount} 件）`}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-3 py-1.5 border border-gray-300 rounded text-[13px] bg-white text-gray-700 disabled:opacity-40 cursor-pointer"
          >
            前へ
          </button>
          {pageNumbers.map((p) => (
            <button
              key={p}
              onClick={() => setPage(p)}
              className={`min-w-[32px] px-2 py-1.5 border rounded text-[13px] cursor-pointer ${
                p === currentPage
                  ? 'bg-[#0070f3] text-white border-[#0070f3]'
                  : 'bg-white text-gray-700 border-gray-300'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="px-3 py-1.5 border border-gray-300 rounded text-[13px] bg-white text-gray-700 disabled:opacity-40 cursor-pointer"
          >
            次へ
          </button>
          <span className="ml-2 text-[12px] text-gray-500">
            {currentPage} / {totalPages} ページ
          </span>
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
