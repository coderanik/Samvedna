-- MINIMAL hotfix: stop profiles 500 (RLS recursion profiles ↔ cases)
-- Run in Supabase → SQL Editor if you only need auth/profile working.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_staff_for_victim(p_victim_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases
    WHERE victim_id = p_victim_id
      AND (
        assigned_counsellor_id = auth.uid()
        OR assigned_official_id = auth.uid()
      )
  )
  OR public.get_my_role() = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.is_assigned_counsellor_or_official()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_my_role() IN ('counsellor', 'official', 'admin');
$$;

DROP POLICY IF EXISTS "Counsellors and officials can read assigned profiles" ON profiles;
CREATE POLICY "Counsellors and officials can read assigned profiles"
  ON profiles FOR SELECT
  USING (
    public.is_assigned_counsellor_or_official()
    AND (
      public.is_staff_for_victim(id)
      OR id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Officials can read district cases" ON cases;
CREATE POLICY "Officials can read district cases"
  ON cases FOR SELECT
  USING (
    public.get_my_role() = 'official'
    AND (
      assigned_official_id = auth.uid()
      OR district IN (
        SELECT c.district FROM cases c
        WHERE c.assigned_official_id = auth.uid()
        LIMIT 1
      )
    )
  );
