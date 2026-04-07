-- ============================================================================
-- Migration: Monthly Analytics Tables for Organizations and Seats
-- ============================================================================
-- Creates tables to store aggregated monthly analytics data for organizations,
-- individual seats (users), and model usage breakdowns.
-- Includes a function to populate these tables from api_request_logs and
-- sets up RLS policies.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. TABLE CREATION & INDEXES
-- ============================================================================

-- Create monthly organization analytics table
CREATE TABLE IF NOT EXISTS public.monthly_org_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    year_month VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
    total_credits_used NUMERIC(10, 2) DEFAULT 0,
    total_usd_spent NUMERIC(10, 4) DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    total_input_tokens BIGINT DEFAULT 0,
    total_output_tokens BIGINT DEFAULT 0,
    seat_count INTEGER DEFAULT 0, -- Number of active seats that month
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_org_analytics_year_month 
    ON public.monthly_org_analytics(year_month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_org_analytics_org 
    ON public.monthly_org_analytics(organization_id, year_month DESC);

-- Create monthly per-seat analytics table
CREATE TABLE IF NOT EXISTS public.monthly_seat_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    year_month VARCHAR(7) NOT NULL, -- Format: 'YYYY-MM'
    total_credits_used NUMERIC(10, 2) DEFAULT 0,
    total_usd_spent NUMERIC(10, 4) DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    total_input_tokens BIGINT DEFAULT 0,
    total_output_tokens BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_seat_analytics_seat 
    ON public.monthly_seat_analytics(user_id, year_month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_seat_analytics_org_seat 
    ON public.monthly_seat_analytics(organization_id, user_id, year_month DESC);

-- Create monthly model usage by organization
CREATE TABLE IF NOT EXISTS public.monthly_org_model_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    provider TEXT,
    year_month VARCHAR(7) NOT NULL,
    total_credits_used NUMERIC(10, 2) DEFAULT 0,
    total_usd_spent NUMERIC(10, 4) DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    total_input_tokens BIGINT DEFAULT 0,
    total_output_tokens BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, model_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_org_model_usage_model 
    ON public.monthly_org_model_usage(model_id, year_month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_org_model_usage_org 
    ON public.monthly_org_model_usage(organization_id, year_month DESC);

-- Create monthly model usage by seat
CREATE TABLE IF NOT EXISTS public.monthly_seat_model_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    provider TEXT,
    year_month VARCHAR(7) NOT NULL,
    total_credits_used NUMERIC(10, 2) DEFAULT 0,
    total_usd_spent NUMERIC(10, 4) DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    total_input_tokens BIGINT DEFAULT 0,
    total_output_tokens BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id, model_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_monthly_seat_model_usage_seat 
    ON public.monthly_seat_model_usage(user_id, year_month DESC);
CREATE INDEX IF NOT EXISTS idx_monthly_seat_model_usage_org_seat 
    ON public.monthly_seat_model_usage(organization_id, user_id, year_month DESC);

-- ============================================================================
-- 2. POPULATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.populate_monthly_analytics(
    p_year_month VARCHAR DEFAULT TO_CHAR(NOW(), 'YYYY-MM')
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_start_date TIMESTAMPTZ;
    v_end_date TIMESTAMPTZ;
BEGIN
    -- Calculate date range for the month
    v_start_date := (p_year_month || '-01')::DATE;
    v_end_date := v_start_date + INTERVAL '1 month';
    
    -- ====================================================================
    -- POPULATE MONTHLY ORG ANALYTICS
    -- ====================================================================
    INSERT INTO public.monthly_org_analytics (
        organization_id,
        year_month,
        total_credits_used,
        total_usd_spent,
        total_requests,
        total_input_tokens,
        total_output_tokens,
        seat_count,
        updated_at
    )
    SELECT 
        arl.organization_id,
        p_year_month,
        SUM(arl.total_cost)::NUMERIC(10, 2),
        SUM(arl.total_cost * 0.014)::NUMERIC(10, 4), -- Assuming $0.014 per credit based on previous migrations
        COUNT(*),
        SUM(arl.input_tokens)::BIGINT,
        SUM(arl.output_tokens)::BIGINT,
        COUNT(DISTINCT arl.user_id), -- Active seats that month
        NOW()
    FROM public.api_request_logs arl
    WHERE arl.organization_id IS NOT NULL
      AND arl.created_at >= v_start_date
      AND arl.created_at < v_end_date
    GROUP BY arl.organization_id
    ON CONFLICT (organization_id, year_month) DO UPDATE
    SET 
        total_credits_used = EXCLUDED.total_credits_used,
        total_usd_spent = EXCLUDED.total_usd_spent,
        total_requests = EXCLUDED.total_requests,
        total_input_tokens = EXCLUDED.total_input_tokens,
        total_output_tokens = EXCLUDED.total_output_tokens,
        seat_count = EXCLUDED.seat_count,
        updated_at = NOW();
    
    -- ====================================================================
    -- POPULATE MONTHLY SEAT ANALYTICS
    -- ====================================================================
    INSERT INTO public.monthly_seat_analytics (
        organization_id,
        user_id,
        year_month,
        total_credits_used,
        total_usd_spent,
        total_requests,
        total_input_tokens,
        total_output_tokens,
        updated_at
    )
    SELECT 
        arl.organization_id,
        arl.user_id,
        p_year_month,
        SUM(arl.total_cost)::NUMERIC(10, 2),
        SUM(arl.total_cost * 0.014)::NUMERIC(10, 4),
        COUNT(*),
        SUM(arl.input_tokens)::BIGINT,
        SUM(arl.output_tokens)::BIGINT,
        NOW()
    FROM public.api_request_logs arl
    WHERE arl.user_id IS NOT NULL
      AND arl.organization_id IS NOT NULL
      AND arl.created_at >= v_start_date
      AND arl.created_at < v_end_date
    GROUP BY arl.organization_id, arl.user_id
    ON CONFLICT (organization_id, user_id, year_month) DO UPDATE
    SET 
        total_credits_used = EXCLUDED.total_credits_used,
        total_usd_spent = EXCLUDED.total_usd_spent,
        total_requests = EXCLUDED.total_requests,
        total_input_tokens = EXCLUDED.total_input_tokens,
        total_output_tokens = EXCLUDED.total_output_tokens,
        updated_at = NOW();
    
    -- ====================================================================
    -- POPULATE MONTHLY ORG MODEL USAGE
    -- ====================================================================
    INSERT INTO public.monthly_org_model_usage (
        organization_id,
        model_id,
        provider,
        year_month,
        total_credits_used,
        total_usd_spent,
        total_requests,
        total_input_tokens,
        total_output_tokens,
        updated_at
    )
    SELECT 
        arl.organization_id,
        arl.model_id,
        arl.provider,
        p_year_month,
        SUM(arl.total_cost)::NUMERIC(10, 2),
        SUM(arl.total_cost * 0.014)::NUMERIC(10, 4),
        COUNT(*),
        SUM(arl.input_tokens)::BIGINT,
        SUM(arl.output_tokens)::BIGINT,
        NOW()
    FROM public.api_request_logs arl
    WHERE arl.organization_id IS NOT NULL
      AND arl.created_at >= v_start_date
      AND arl.created_at < v_end_date
    GROUP BY arl.organization_id, arl.model_id, arl.provider
    ON CONFLICT (organization_id, model_id, year_month) DO UPDATE
    SET 
        total_credits_used = EXCLUDED.total_credits_used,
        total_usd_spent = EXCLUDED.total_usd_spent,
        total_requests = EXCLUDED.total_requests,
        total_input_tokens = EXCLUDED.total_input_tokens,
        total_output_tokens = EXCLUDED.total_output_tokens,
        updated_at = NOW();
    
    -- ====================================================================
    -- POPULATE MONTHLY SEAT MODEL USAGE
    -- ====================================================================
    INSERT INTO public.monthly_seat_model_usage (
        organization_id,
        user_id,
        model_id,
        provider,
        year_month,
        total_credits_used,
        total_usd_spent,
        total_requests,
        total_input_tokens,
        total_output_tokens,
        updated_at
    )
    SELECT 
        arl.organization_id,
        arl.user_id,
        arl.model_id,
        arl.provider,
        p_year_month,
        SUM(arl.total_cost)::NUMERIC(10, 2),
        SUM(arl.total_cost * 0.014)::NUMERIC(10, 4),
        COUNT(*),
        SUM(arl.input_tokens)::BIGINT,
        SUM(arl.output_tokens)::BIGINT,
        NOW()
    FROM public.api_request_logs arl
    WHERE arl.user_id IS NOT NULL
      AND arl.organization_id IS NOT NULL
      AND arl.created_at >= v_start_date
      AND arl.created_at < v_end_date
    GROUP BY arl.organization_id, arl.user_id, arl.model_id, arl.provider
    ON CONFLICT (organization_id, user_id, model_id, year_month) DO UPDATE
    SET 
        total_credits_used = EXCLUDED.total_credits_used,
        total_usd_spent = EXCLUDED.total_usd_spent,
        total_requests = EXCLUDED.total_requests,
        total_input_tokens = EXCLUDED.total_input_tokens,
        total_output_tokens = EXCLUDED.total_output_tokens,
        updated_at = NOW();
    
    RAISE NOTICE 'Successfully populated analytics for month: %', p_year_month;
END;
$$;

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE public.monthly_org_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_seat_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_org_model_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_seat_model_usage ENABLE ROW LEVEL SECURITY;

-- Policy: Org members can view their org's monthly analytics
CREATE POLICY "Org members can view org analytics"
ON public.monthly_org_analytics
FOR SELECT
USING (
  organization_id IN (
    SELECT o.id
    FROM public.organizations o
    INNER JOIN public.organization_members om ON om.organization_id = o.id
    WHERE om.user_id = auth.uid()
  )
);

-- Policy: Org members can view seat analytics for their org
CREATE POLICY "Org members can view seat analytics"
ON public.monthly_seat_analytics
FOR SELECT
USING (
  organization_id IN (
    SELECT o.id
    FROM public.organizations o
    INNER JOIN public.organization_members om ON om.organization_id = o.id
    WHERE om.user_id = auth.uid()
  )
);

-- Policy: Org members can view org model usage
CREATE POLICY "Org members can view org model usage"
ON public.monthly_org_model_usage
FOR SELECT
USING (
  organization_id IN (
    SELECT o.id
    FROM public.organizations o
    INNER JOIN public.organization_members om ON om.organization_id = o.id
    WHERE om.user_id = auth.uid()
  )
);

-- Policy: Org members can view seat model usage for their org
CREATE POLICY "Org members can view seat model usage"
ON public.monthly_seat_model_usage
FOR SELECT
USING (
  organization_id IN (
    SELECT o.id
    FROM public.organizations o
    INNER JOIN public.organization_members om ON om.organization_id = o.id
    WHERE om.user_id = auth.uid()
  )
);

-- ============================================================================
-- 4. CRON JOB SETUP (Requires pg_cron extension)
-- ============================================================================
-- Note: pg_cron must be enabled in the Supabase dashboard (Database -> Extensions)
-- If it's enabled, this will schedule the aggregation to run daily at 1:00 AM UTC.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Schedule job to run daily at 1:00 AM
    -- It updates the current month's data
    PERFORM cron.schedule(
      'populate_monthly_analytics_current',
      '0 1 * * *',
      $$SELECT public.populate_monthly_analytics(TO_CHAR(NOW(), 'YYYY-MM'))$$
    );
    
    -- Schedule job to run on the 1st of every month at 2:00 AM
    -- It updates the previous month's data to ensure final numbers are accurate
    PERFORM cron.schedule(
      'populate_monthly_analytics_previous',
      '0 2 1 * *',
      $$SELECT public.populate_monthly_analytics(TO_CHAR(NOW() - INTERVAL '1 month', 'YYYY-MM'))$$
    );
  END IF;
END
$$;

COMMIT;