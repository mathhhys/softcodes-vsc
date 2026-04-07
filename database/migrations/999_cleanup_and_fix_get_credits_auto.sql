-- COMPREHENSIVE CLEANUP AND FIX FOR get_credits_auto()
-- Run this script in your Supabase SQL Editor to fix the "function does not exist" error
-- 
-- ERROR CAUSE: PostgreSQL can't match function signature when UUID parameters are passed as strings
-- SOLUTION: Explicitly cast NULL values to UUID type in function definition

-- ============================================================
-- STEP 1: Drop ALL existing versions of get_credits_auto
-- ============================================================
DROP FUNCTION IF EXISTS public.get_credits_auto();
DROP FUNCTION IF EXISTS public.get_credits_auto(UUID);
DROP FUNCTION IF EXISTS public.get_credits_auto(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_credits_auto(UUID DEFAULT NULL, UUID DEFAULT NULL);
DROP FUNCTION IF EXISTS public.get_credits_auto(p_user_id UUID, p_org_id UUID);
DROP FUNCTION IF EXISTS public.get_credits_auto(p_user_id UUID DEFAULT NULL, p_org_id UUID DEFAULT NULL);

-- ============================================================
-- STEP 2: Verify all overloads are removed
-- ============================================================
SELECT 
    proname, 
    proargtypes::regtype[] as argument_types,
    prosrc as function_body_preview
FROM pg_proc 
WHERE proname = 'get_credits_auto'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- Expected result: No rows returned (function fully removed)

-- ============================================================
-- STEP 3: Create the function FRESH with proper UUID type casting
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_credits_auto(
    p_user_id UUID DEFAULT NULL::UUID,
    p_org_id UUID DEFAULT NULL::UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_org_id UUID;
    v_result JSONB;
BEGIN
    -- Identify User (Param overrides JWT)
    v_user_id := COALESCE(p_user_id, auth.uid());
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'unauthorized',
            'message', 'User not identified'
        );
    END IF;

    -- Identify Org (Param overrides JWT)
    IF p_org_id IS NOT NULL THEN
        v_org_id := p_org_id;
    ELSE
        BEGIN
            v_org_id := (auth.jwt() ->> 'org_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_org_id := NULL;
        END;
    END IF;

    -- Fetch balance based on context
    IF v_org_id IS NOT NULL THEN
        -- Fetch Organization Balance
        SELECT jsonb_build_object(
            'success', true,
            'user_id', v_user_id,
            'org_id', id,
            'current_credits', total_credits,
            'credits_used', COALESCE(credits_used, 0),
            'total_spent_usd', COALESCE(total_spent_usd, 0.00),
            'last_credit_update', last_credit_update,
            'plan_type', plan_type,
            'is_organization', true
        ) INTO v_result
        FROM public.organizations
        WHERE id = v_org_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'organization_not_found',
                'message', 'Organization not found'
            );
        END IF;
    ELSE
        -- Fetch User Balance
        SELECT jsonb_build_object(
            'success', true,
            'user_id', id,
            'org_id', NULL,
            'current_credits', COALESCE(credits, 0),
            'credits_used', COALESCE(credits_used, 0),
            'total_spent_usd', COALESCE(total_spent_usd, 0.00),
            'last_credit_update', last_credit_update,
            'plan_type', plan_type,
            'is_organization', false
        ) INTO v_result
        FROM public.users
        WHERE id = v_user_id;

        IF NOT FOUND THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'user_not_found',
                'message', 'User not found'
            );
        END IF;
    END IF;

    RETURN v_result;
END;
$$;

-- ============================================================
-- STEP 4: Grant permissions
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_credits_auto(UUID, UUID) TO authenticated;

-- ============================================================
-- STEP 5: Add comment for documentation
-- ============================================================
COMMENT ON FUNCTION public.get_credits_auto(UUID, UUID) IS 
'Automatically returns the correct credit balance (Organization or User) based on the JWT org_id claim.';

-- ============================================================
-- STEP 6: Verify the function was created correctly
-- ============================================================
SELECT 
    proname, 
    proargtypes::regtype[] as argument_types,
    proargnames as parameter_names
FROM pg_proc 
WHERE proname = 'get_credits_auto'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ============================================================
-- STEP 7: Test the function with explicit UUID casting
-- ============================================================
-- Test 1: Call with NULL UUIDs (this is what TypeScript should do)
SELECT * FROM public.get_credits_auto(NULL::UUID, NULL::UUID);

-- Test 2: Call with actual UUID values (replace with valid user/org UUIDs)
-- SELECT * FROM public.get_credits_auto('12345678-1234-1234-1234-123456789012'::UUID, NULL::UUID);

-- ============================================================
-- STEP 8: Verify function can be found by PostgreSQL
-- ============================================================
SELECT 
    p.proname,
    pg_get_function_arguments(p.oid) as full_signature
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname = 'get_credits_auto';

-- SUCCESS: You should see one row with get_credits_auto and signature: "p_user_id uuid, p_org_id uuid"