/*
# stock テーブル RLS 有効化・ポリシー追加・模擬データ投入

## 変更内容
- public.stock テーブルの Row Level Security を有効化
- anon / authenticated の両ロールに対して SELECT/INSERT/UPDATE/DELETE ポリシーを追加
  （このツールはサインイン不要のブラウザ完結アプリのため anon キーで動作する）
- 模擬データ 3 件を INSERT（DEMO-001〜003、SKU 衝突時は plug_name を上書き）

## ポリシー一覧
- stock_select: SELECT → anon, authenticated (USING true)
- stock_insert: INSERT → anon, authenticated (WITH CHECK true)
- stock_update: UPDATE → anon, authenticated (USING/WITH CHECK true)
- stock_delete: DELETE → anon, authenticated (USING true)

## 注意
データは意図的に共有・公開データとして扱う（価格改定ツール内部用マスタ）。
USING (true) は所有権チェックが不要な単一テナント用途のため適正。
*/

ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_select" ON public.stock;
CREATE POLICY "stock_select" ON public.stock FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "stock_insert" ON public.stock;
CREATE POLICY "stock_insert" ON public.stock FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "stock_update" ON public.stock;
CREATE POLICY "stock_update" ON public.stock FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "stock_delete" ON public.stock;
CREATE POLICY "stock_delete" ON public.stock FOR DELETE
  TO anon, authenticated USING (true);

INSERT INTO public.stock (sku, plug_name)
VALUES
  ('DEMO-001', 'MOGAMI 2534'),
  ('DEMO-002', 'BELDEN 88760'),
  ('DEMO-003', 'CANARE L-4E6S')
ON CONFLICT (sku) DO UPDATE SET plug_name = EXCLUDED.plug_name;
