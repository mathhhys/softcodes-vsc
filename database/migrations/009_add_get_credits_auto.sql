-- Migration: Add Automatic Credit Balance Lookup
-- This function automatically returns the correct balance (Org or User)
-- based on the org_id claim in the JWT.

BEGIN;

-- Drop old versions to prevent signature mismatch
DROP FUNCTION IF EXISTS public.get_credits_auto();

CREATE OR REPLACE FUNCTION public.get_credits_auto(
    p_user_id UUID DEFAULT NULL,
    p_org_id UUID DEFAULT NULL
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
    -- 1. Identify User (Param overrides JWT)
    v_user_id := COALESCE(p_user_id, auth.uid());
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'unauthorized',
            'message', 'User not identified'
        );
    END IF;

    -- 2. Identify Org (Param overrides JWT)
    IF p_org_id IS NOT NULL THEN
        v_org_id := p_org_id;
    ELSE
        BEGIN
            v_org_id := (auth.jwt() ->> 'org_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_org_id := NULL;
        END;
    END IF;

    -- 3. Fetch balance based on context
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
                'message', 'Organization in JWT not found in database'
            );
        END IF;
    ELSE
        -- Fetch User Balance (Legacy/Personal)
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
                'message', 'User not found in database'
            );
        END IF;
    END IF;

    RETURN v_result;
END;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.get_credits_auto(UUID, UUID) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_credits_auto(UUID, UUID) IS
'Automatically returns the correct credit balance (Organization or User) based on the JWT org_id claim.';

COMMIT;