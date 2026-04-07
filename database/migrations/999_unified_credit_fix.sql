-- UNIFIED CREDIT SYSTEM FIX
-- This script ensures all functions are created with the correct signatures
-- and handles the transition from user-only to context-aware (Org/User) credits.
-- 
-- IMPORTANT: Run this script to fix the "function does not exist" error
-- The error occurs when parameters are not properly typed as UUID.

BEGIN;

-- 1. Cleanup ALL old versions to ensure clean slate
DROP FUNCTION IF EXISTS public.get_credits_auto();
DROP FUNCTION IF EXISTS public.get_credits_auto(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_credits_auto(UUID DEFAULT NULL, UUID DEFAULT NULL);
DROP FUNCTION IF EXISTS public.deduct_credits_auto();
DROP FUNCTION IF EXISTS public.deduct_credits_auto(NUMERIC, TEXT, JSONB);
DROP FUNCTION IF EXISTS public.deduct_credits_auto(NUMERIC, TEXT, JSONB, UUID, UUID);
DROP FUNCTION IF EXISTS public.deduct_credits_auto(NUMERIC, TEXT, JSONB, UUID DEFAULT NULL, UUID DEFAULT NULL);

-- 2. Create get_credits_auto with explicit UUID parameter types
-- This function returns the correct balance based on JWT or explicit params
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

-- 3. Create deduct_credits_auto with explicit UUID parameter types
CREATE OR REPLACE FUNCTION public.deduct_credits_auto(
    p_usd_amount NUMERIC(10, 4),
    p_description TEXT DEFAULT 'Credit deduction',
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_user_id UUID DEFAULT NULL::UUID,
    p_org_id UUID DEFAULT NULL::UUID
)
RETURNS TABLE(
    success BOOLEAN,
    credits_deducted NUMERIC(10, 2),
    balance_before NUMERIC(10, 2),
    balance_after NUMERIC(10, 2),
    usd_amount NUMERIC(10, 4),
    transaction_id UUID,
    user_id UUID,
    error TEXT,
    message TEXT
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_org_id UUID;
BEGIN
    -- Identify User (Param overrides JWT)
    v_user_id := COALESCE(p_user_id, auth.uid());
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT 
            FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, p_usd_amount, NULL::UUID, NULL::UUID,
            'unauthorized'::TEXT, 'User not identified'::TEXT;
        RETURN;
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

    -- Call core logic
    RETURN QUERY 
    SELECT * FROM public.deduct_user_credits(
        p_user_id := v_user_id,
        p_credits_to_deduct := 0,
        p_usd_amount := p_usd_amount,
        p_description := p_description,
        p_metadata := p_metadata,
        p_org_id := v_org_id
    );
END;
$$;

-- 4. Permissions - Use explicit parameter types for GRANT
GRANT EXECUTE ON FUNCTION public.get_credits_auto(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_credits_auto(NUMERIC, TEXT, JSONB, UUID, UUID) TO authenticated;

-- 5. Verify the function was created correctly
SELECT proname, proargtypes::regtype[] as argument_types, prosrc as source
FROM pg_proc 
WHERE proname = 'get_credits_auto'
  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

COMMIT;