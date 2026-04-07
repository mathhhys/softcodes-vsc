-- ============================================================================
-- Function: get_organization_credit_info
-- ============================================================================
-- Retrieves comprehensive credit information for an organization by its ID
-- Returns credit balance, usage stats, and plan information
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_organization_credit_info(
    p_org_id UUID
)
RETURNS TABLE(
    success BOOLEAN,
    org_id UUID,
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
        o.id,
        o.total_credits,
        COALESCE(o.credits_used, 0::NUMERIC(10, 2)),
        COALESCE(o.total_spent_usd, 0::NUMERIC(10, 4)),
        o.plan_type,
        o.last_credit_update,
        'Organization credit info retrieved successfully'::TEXT,
        NULL::TEXT
    FROM public.organizations o
    WHERE o.id = p_org_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT 
            FALSE,
            p_org_id,
            0::NUMERIC(10, 2),
            0::NUMERIC(10, 2),
            0::NUMERIC(10, 4),
            NULL::TEXT,
            NULL::TIMESTAMPTZ,
            NULL::TEXT,
            'Organization not found'::TEXT;
    END IF;
END;
$$;

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.get_organization_credit_info TO service_role;
GRANT EXECUTE ON FUNCTION public.get_organization_credit_info TO anon;

-- Add comment
COMMENT ON FUNCTION public.get_organization_credit_info IS 
'Retrieves organization credit information by Organization ID with decimal precision support for fractional credits';