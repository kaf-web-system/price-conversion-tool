-- 適用は「ログイン機能つきアプリを本番に公開した後」に行うこと（先に適用すると現行アプリが止まる）
-- このファイルは参考用。データベースには手動で適用してください。

-- ========================================
-- public.stock
-- ========================================
ALTER TABLE public.stock ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stock'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stock', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "stock_select_authenticated" ON public.stock
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "stock_insert_authenticated" ON public.stock
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "stock_update_authenticated" ON public.stock
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "stock_delete_authenticated" ON public.stock
  FOR DELETE TO authenticated USING (true);

-- ========================================
-- public.stock_shopify
-- ========================================
ALTER TABLE public.stock_shopify ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'stock_shopify'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.stock_shopify', r.policyname);
  END LOOP;
END $$;

CREATE POLICY "stock_shopify_select_authenticated" ON public.stock_shopify
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "stock_shopify_insert_authenticated" ON public.stock_shopify
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "stock_shopify_update_authenticated" ON public.stock_shopify
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "stock_shopify_delete_authenticated" ON public.stock_shopify
  FOR DELETE TO authenticated USING (true);
