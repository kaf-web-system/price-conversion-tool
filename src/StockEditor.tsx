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

  // 新規追加フォーム
  const [draft, setDraft] = useState<DraftRow>(EMPTY_DRAFT);

  // インライン編集
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

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 24, fontFamily: 'sans-serif', color: '#000' }}>
      <h2 style={{ marginTop: 0 }}>在庫DB（stock）編集</h2>
      <p style={{ color: '#555', fontSize: 13, margin: '0 0 16px' }}>
        SKU と プラグ型番（plug_name）の対応を管理します。
        ここで登録した plug_name が価格改定ツールのプラグ判定に使われます。
      </p>

      {error && (
        <div style={msgStyle('#fff5f5', '#fcc', '#c00')}><b>エラー:</b> {error}</div>
      )}
      {success && (
        <div style={msgStyle('#f0fff4', '#9e9', '#080')}>{success}</div>
      )}

      {/* 新規追加フォーム */}
      <div style={{ ...card, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>新規追加</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            placeholder="SKU（必須）"
            value={draft.sku}
            onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            style={inp}
          />
          <input
            placeholder="プラグ型番 / plug_name"
            value={draft.plug_name}
            onChange={(e) => setDraft((d) => ({ ...d, plug_name: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            style={{ ...inp, minWidth: 220 }}
          />
          <button onClick={handleAdd} style={btnPrimary}>追加</button>
        </div>
      </div>

      {/* 一覧テーブル */}
      <div style={{ border: '1px solid #ddd', borderRadius: 4, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={th}>SKU</th>
              <th style={th}>plug_name</th>
              <th style={th}>登録日時</th>
              <th style={{ ...th, width: 120 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#888' }}>読み込み中...</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#888' }}>データがありません</td></tr>
            )}
            {rows.map((row) =>
              editId === row.id ? (
                <tr key={row.id} style={{ background: '#fffef0' }}>
                  <td style={td}>
                    <input
                      value={editDraft.sku}
                      onChange={(e) => setEditDraft((d) => ({ ...d, sku: e.target.value }))}
                      style={{ ...inp, width: '100%' }}
                    />
                  </td>
                  <td style={td}>
                    <input
                      value={editDraft.plug_name}
                      onChange={(e) => setEditDraft((d) => ({ ...d, plug_name: e.target.value }))}
                      style={{ ...inp, width: '100%' }}
                    />
                  </td>
                  <td style={{ ...td, color: '#aaa', fontSize: 11 }}>{formatDate(row.created_at)}</td>
                  <td style={td}>
                    <button onClick={() => handleSave(row.id)} style={{ ...btnSmall, background: '#0070f3', color: '#fff', marginRight: 4 }}>保存</button>
                    <button onClick={cancelEdit} style={btnSmall}>取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={td}>{row.sku}</td>
                  <td style={{ ...td, color: row.plug_name ? '#000' : '#bbb' }}>{row.plug_name ?? '（未設定）'}</td>
                  <td style={{ ...td, color: '#888', fontSize: 11 }}>{formatDate(row.created_at)}</td>
                  <td style={td}>
                    <button onClick={() => startEdit(row)} style={{ ...btnSmall, marginRight: 4 }}>編集</button>
                    <button onClick={() => handleDelete(row.id, row.sku)} style={{ ...btnSmall, color: '#c00', borderColor: '#fcc' }}>削除</button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>合計 {rows.length} 件</p>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const card: React.CSSProperties = { border: '1px solid #ddd', borderRadius: 4, padding: 12 };
const th: React.CSSProperties = { border: '1px solid #ddd', padding: '6px 10px', textAlign: 'left', fontWeight: 600 };
const td: React.CSSProperties = { padding: '6px 10px', verticalAlign: 'middle' };
const inp: React.CSSProperties = { padding: '5px 8px', border: '1px solid #bbb', borderRadius: 3, fontSize: 13, background: '#fff', color: '#000', minWidth: 160, boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { padding: '6px 16px', background: '#0070f3', color: '#fff', border: 0, borderRadius: 3, cursor: 'pointer', fontSize: 13 };
const btnSmall: React.CSSProperties = { padding: '3px 10px', background: '#fff', color: '#333', border: '1px solid #ccc', borderRadius: 3, cursor: 'pointer', fontSize: 12 };
function msgStyle(bg: string, border: string, color: string): React.CSSProperties {
  return { background: bg, border: `1px solid ${border}`, color, borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 13 };
}
