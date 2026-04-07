-- Migration: Add Automatic Credit Deduction Wrapper
-- This function automatically extracts user_id and org_id from the JWT
-- to simplify credit deduction from the client side.

BEGIN;

-- Drop old versions to prevent signature mismatch
DROP FUNCTION IF EXISTS public.deduct_credits_auto();
DROP FUNCTION IF EXISTS public.deduct_credits_auto(NUMERIC, TEXT, JSONB);

CREATE OR REPLACE FUNCTION public.deduct_credits_auto(
    p_usd_amount NUMERIC(10, 4),
    p_description TEXT DEFAULT 'Credit deduction',
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_user_id UUID DEFAULT NULL,
    p_org_id UUID DEFAULT NULL
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
SECURITY DEFINER -- Required to update tables and bypass RLS if necessary
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_org_id UUID;
BEGIN
    -- 1. Identify User (Param overrides JWT)
    v_user_id := COALESCE(p_user_id, auth.uid());
    
    IF v_user_id IS NULL THEN
        RETURN QUERY SELECT
            FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, p_usd_amount, NULL::UUID, NULL::UUID,
            'unauthorized'::TEXT, 'User not identified'::TEXT;
        RETURN;
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

    -- 3. Call the core deduction logic
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

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.deduct_credits_auto(NUMERIC, TEXT, JSONB, UUID, UUID) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.deduct_credits_auto(NUMERIC, TEXT, JSONB, UUID, UUID) IS
'Automatically deducts credits using user_id and org_id extracted from the JWT token.';

COMMIT;