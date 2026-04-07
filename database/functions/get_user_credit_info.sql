-- ============================================================================
-- Function: get_user_credit_info
-- ============================================================================
-- Retrieves comprehensive credit information for a user by their Clerk ID
-- Returns credit balance, usage stats, and plan information
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_credit_info(
    p_clerk_id TEXT
)
RETURNS TABLE(
    success BOOLEAN,
    user_id UUID,
    clerk_id TEXT,
    current_credits NUMERIC(10, 2),
    credits_used NUMERIC(10, 2),
    total_spent_usd NUMERIC(10, 4),
    plan_type TEXT,
    last_credit_update TIMESTAMPTZ,
    message TEXT,
    error TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        TRUE,
        u.id,
        u.clerk_id,
        u.credits,
        COALESCE(u.credits_used, 0::NUMERIC(10, 2)),
        COALESCE(u.total_spent_usd, 0::NUMERIC(10, 4)),
        u.plan_type,
        u.last_credit_update,
        'User credit info retrieved successfully'::TEXT,
        NULL::TEXT
    FROM public.users u
    WHERE u.clerk_id = p_clerk_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            FALSE,
            NULL::UUID,
            p_clerk_id,
            0::NUMERIC(10, 2),
            0::NUMERIC(10, 2),
            0::NUMERIC(10, 4),
            NULL::TEXT,
            NULL::TIMESTAMPTZ,
            NULL::TEXT,
            'User not found'::TEXT;
    END IF;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.get_user_credit_info TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_credit_info TO anon;

-- Add comment
COMMENT ON FUNCTION public.get_user_credit_info IS 
'Retrieves user credit information by Clerk ID with decimal precision support for fractional credits';

-- ============================================================================
-- Test Query (run after creating function)
-- ============================================================================
-- Test retrieval:
-- 
-- SELECT * FROM get_user_credit_info('your-clerk-user-id');
--
-- Expected: Should return current_credits with 2 decimal places (e.g., 198.62)
-- ============================================================================