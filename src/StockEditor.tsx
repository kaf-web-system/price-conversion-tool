import { useCallback, useEffect, useState } from 'react';

type StockRow = {
  id: string;
  sku: string;
  plug_name: string | null;
  created_at: string;
};

type DraftRow = { sku: string; plug_name: string };

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

const EMPTY_DRAFT: DraftRow = { sku: '', plug_name: '' };

export default function StockEditor() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [draft, setDraft] = useState<DraftRow>(EMPTY_DRAFT);

  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftRow>(EMPTY_DRAFT);

  const notify = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 3000);
  };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch('stock?select=id,sku,plug_name,created_at&order=created_at.asc');
      setRows(await resp.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleAdd = async () => {
    const sku = draft.sku.trim();
    const plug_name = draft.plug_name.trim();
    if (!sku) { setError('SKU は必須です'); return; }
    setError(null);
    try {
      await apiFetch('stock', {
        method: 'POST',
        body: JSON.stringify({ sku, plug_name: plug_name || null }),
      });
      setDraft(EMPTY_DRAFT);
      notify('追加しました');
      await fetchRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const startEdit = (row: StockRow) => {
    setEditId(row.id);
    setEditDraft({ sku: row.sku, plug_name: row.plug_name ?? '' });
  };

  const cancelEdit = () => { setEditId(null); setEditDraft(EMPTY_DRAFT); };

  const handleSave = async (id: string) => {
    const sku = editDraft.sku.trim();
    const plug_name = editDraft.plug_name.trim();
    if (!sku) { setError('SKU は必須です'); return; }
    setError(null);
    try {
      await apiFetch(`stock?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sku, plug_name: plug_name || null }),
      });
      cancelEdit();
      notify('更新しました');
      await fetchRows();
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
      await fetchRows();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const filteredRows = rows.filter((row) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return row.sku.toLowerCase().includes(q) || (row.plug_name ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="max-w-[860px] mx-auto p-6 font-sans text-black">
      <h2 className="mt-0">在庫DB（stock）編集</h2>
      <p className="text-gray-600 text-[13px] mb-4">
        SKU と プラグ型番（plug_name）の対応を管理します。
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
            placeholder="プラグ型番 / plug_name"
            value={draft.plug_name}
            onChange={(e) => setDraft((d) => ({ ...d, plug_name: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black min-w-[220px] box-border"
          />
          <button onClick={handleAdd} className="px-4 py-1.5 bg-[#0070f3] text-white border-0 rounded cursor-pointer text-[13px]">追加</button>
        </div>
      </div>

      {/* 検索ボックス */}
      <div className="mb-2.5">
        <input
          placeholder="SKU / plug_name で絞り込み（部分一致）"
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
              <th className="border border-gray-300 px-2.5 py-1.5 text-left font-semibold">plug_name</th>
              <th className="border border-gray-300 px-2.5 py-1.5 text-left font-semibold">登録日時</th>
              <th className="border border-gray-300 px-2.5 py-1.5 text-left font-semibold w-[120px]">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} className="p-4 text-center text-gray-500">読み込み中...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4} className="p-4 text-center text-gray-500">データがありません</td></tr>
            )}
            {filteredRows.map((row) =>
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
                      value={editDraft.plug_name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, plug_name: e.target.value }))}
                      className="px-2 py-1 border border-gray-400 rounded text-[13px] bg-white text-black w-full box-border"
                    />
                  </td>
                  <td className="px-2.5 py-1.5 align-middle text-gray-300 text-[11px]">{formatDate(row.created_at)}</td>
                  <td className="px-2.5 py-1.5 align-middle">
                    <button onClick={() => handleSave(row.id)} className="px-2.5 py-0.5 bg-[#0070f3] text-white border-0 rounded cursor-pointer text-xs mr-1">保存</button>
                    <button onClick={cancelEdit} className="px-2.5 py-0.5 bg-white text-gray-700 border border-gray-300 rounded cursor-pointer text-xs">取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} className="border-t border-gray-200">
                  <td className="px-2.5 py-1.5 align-middle">{row.sku}</td>
                  <td className={`px-2.5 py-1.5 align-middle ${row.plug_name ? 'text-black' : 'text-gray-300'}`}>{row.plug_name ?? '（未設定）'}</td>
                  <td className="px-2.5 py-1.5 align-middle text-gray-500 text-[11px]">{formatDate(row.created_at)}</td>
                  <td className="px-2.5 py-1.5 align-middle">
                    <button onClick={() => startEdit(row)} className="px-2.5 py-0.5 bg-white text-gray-700 border border-gray-300 rounded cursor-pointer text-xs mr-1">編集</button>
                    <button onClick={() => handleDelete(row.id, row.sku)} className="px-2.5 py-0.5 bg-white text-red-600 border border-red-200 rounded cursor-pointer text-xs">削除</button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500 mt-2">
        {search
          ? `${filteredRows.length} 件（全 ${rows.length} 件中）`
          : `合計 ${rows.length} 件`}
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
