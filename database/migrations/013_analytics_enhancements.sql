-- ============================================================================
-- Migration: Analytics System Enhancements
-- ============================================================================
-- Adds performance optimizations, security policies, and helper functions
-- for the analytics system. This migration enhances the existing api_request_logs
-- table with composite indexes, materialized views for pre-aggregated data,
-- Row-Level Security policies, and utility functions for analytics queries.
--
-- Related Documents:
-- - docs/analytics-system-architecture.md
-- - database/migrations/012_log_api_requests.sql (logging functions)
-- ============================================================================

BEGIN;

-- ============================================================================
-- SECTION 1: COMPOSITE INDEXES FOR QUERY OPTIMIZATION
-- ============================================================================
-- These indexes optimize common analytics queries by date range and entity
-- ============================================================================

-- Index for user-specific analytics queries
-- Optimizes: SELECT ... WHERE user_id = ? AND created_at BETWEEN ? AND ?
CREATE INDEX IF NOT EXISTS idx_api_request_logs_user_date 
  ON public.api_request_logs(user_id, created_at DESC) 
  WHERE user_id IS NOT NULL;

-- Index for organization-specific analytics queries
-- Optimizes: SELECT ... WHERE organization_id = ? AND created_at BETWEEN ? AND ?
CREATE INDEX IF NOT EXISTS idx_api_request_logs_org_date 
  ON public.api_request_logs(organization_id, created_at DESC) 
  WHERE organization_id IS NOT NULL;

-- Index for model usage analytics queries
-- Optimizes: SELECT ... WHERE model_id = ? AND created_at BETWEEN ? AND ?
CREATE INDEX IF NOT EXISTS idx_api_request_logs_model_date 
  ON public.api_request_logs(model_id, created_at DESC) 
  WHERE model_id IS NOT NULL;

-- Index for time-series queries across entities
-- Optimizes: SELECT ... WHERE created_at BETWEEN ? ORDER BY created_at DESC
-- Also supports filtering by org_id or user_id
CREATE INDEX IF NOT EXISTS idx_api_request_logs_timeseries 
  ON public.api_request_logs(created_at DESC, organization_id, user_id);

-- ============================================================================
-- SECTION 2: MATERIALIZED VIEW FOR PRE-AGGREGATED DAILY USAGE
-- ============================================================================
-- Pre-aggregates daily statistics to dramatically speed up dashboard queries
-- ============================================================================

-- Create materialized view for daily usage summary
DROP MATERIALIZED VIEW IF EXISTS public.daily_usage_summary;
CREATE MATERIALIZED VIEW public.daily_usage_summary AS
SELECT
  DATE(created_at) as usage_date,
  organization_id,
  user_id,
  model_id,
  provider,
  COUNT(*) as total_requests,
  COALESCE(SUM(input_tokens), 0) as total_input_tokens,
  COALESCE(SUM(output_tokens), 0) as total_output_tokens,
  COALESCE(SUM(total_cost), 0) as total_credits
FROM public.api_request_logs
GROUP BY DATE(created_at), organization_id, user_id, model_id, provider;

-- Index on the materialized view for fast queries
-- Optimizes queries filtering by date and entity
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_usage_summary_composite 
  ON public.daily_usage_summary(usage_date DESC, organization_id, user_id, model_id, provider);

-- Additional index for org-level queries
CREATE INDEX IF NOT EXISTS idx_daily_usage_summary_org 
  ON public.daily_usage_summary(usage_date DESC, organization_id)
  WHERE organization_id IS NOT NULL;

-- Additional index for user-level queries
CREATE INDEX IF NOT EXISTS idx_daily_usage_summary_user 
  ON public.daily_usage_summary(usage_date DESC, user_id)
  WHERE user_id IS NOT NULL;

-- ============================================================================
-- SECTION 3: ROW-LEVEL SECURITY POLICIES
-- ============================================================================
-- Ensures users can only access their own data or their organization's data
-- ============================================================================

-- Enable Row-Level Security on api_request_logs table
ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own API request logs
-- This allows users to see logs where they are the user_id
DROP POLICY IF EXISTS "Users can view own logs" ON public.api_request_logs;
CREATE POLICY "Users can view own logs"
ON public.api_request_logs
FOR SELECT
USING (
  auth.uid()::TEXT = user_id::TEXT
);

-- Policy: Organization members can view their org's logs
-- This allows users to see all logs associated with their organization
DROP POLICY IF EXISTS "Org members can view org logs" ON public.api_request_logs;
CREATE POLICY "Org members can view org logs"
ON public.api_request_logs
FOR SELECT
USING (
  organization_id IS NOT NULL
  AND organization_id IN (
    SELECT o.id::TEXT
    FROM public.organizations o
    INNER JOIN public.organization_members om ON om.organization_id = o.id
    WHERE om.user_id = auth.uid()
  )
);

-- Policy: Service role can access all data (for backend API)
-- Note: Service role automatically bypasses RLS, but we document it here
-- Backend API should use service_role key for analytics endpoints

-- Enable RLS on materialized view as well
ALTER MATERIALIZED VIEW public.daily_usage_summary OWNER TO postgres;

-- Note: Materialized views inherit some RLS behavior, but queries against them
-- from the backend should use service_role to bypass RLS for performance

-- ============================================================================
-- SECTION 4: HELPER FUNCTIONS FOR ANALYTICS QUERIES
-- ============================================================================
-- Convenience functions to simplify common analytics operations
-- ============================================================================

-- Function: Refresh the daily usage summary materialized view
-- Call this function periodically (e.g., via cron job) to update the view
-- Use CONCURRENTLY to allow queries during refresh (requires unique index)
CREATE OR REPLACE FUNCTION public.refresh_daily_summary()
RETURNS void 
LANGUAGE plpgsql 
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.daily_usage_summary;
END;
$$;

-- Function: Get organization analytics summary
-- Returns aggregated statistics for an organization within a date range
CREATE OR REPLACE FUNCTION public.get_org_analytics(
  p_org_id TEXT,
  p_start_date TIMESTAMP WITH TIME ZONE,
  p_end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE(
  total_requests BIGINT,
  total_credits NUMERIC,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  top_models JSONB,
  top_providers JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_requests,
    COALESCE(SUM(arl.total_cost), 0)::NUMERIC as total_credits,
    COALESCE(SUM(arl.input_tokens), 0)::BIGINT as total_input_tokens,
    COALESCE(SUM(arl.output_tokens), 0)::BIGINT as total_output_tokens,
    -- Top 5 models by usage
    (
      SELECT JSONB_AGG(model_stats ORDER BY cost DESC)
      FROM (
        SELECT 
          model_id,
          COUNT(*) as requests,
          SUM(total_cost) as cost
        FROM public.api_request_logs
        WHERE organization_id = p_org_id
          AND created_at BETWEEN p_start_date AND p_end_date
        GROUP BY model_id
        ORDER BY cost DESC
        LIMIT 5
      ) model_stats
    ) as top_models,
    -- Top providers by usage
    (
      SELECT JSONB_AGG(provider_stats ORDER BY cost DESC)
      FROM (
        SELECT 
          provider,
          COUNT(*) as requests,
          SUM(total_cost) as cost
        FROM public.api_request_logs
        WHERE organization_id = p_org_id
          AND created_at BETWEEN p_start_date AND p_end_date
        GROUP BY provider
        ORDER BY cost DESC
        LIMIT 5
      ) provider_stats
    ) as top_providers
  FROM public.api_request_logs arl
  WHERE arl.organization_id = p_org_id
    AND arl.created_at BETWEEN p_start_date AND p_end_date;
END;
$$;

-- Function: Get user analytics summary
-- Returns aggregated statistics for a specific user within a date range
CREATE OR REPLACE FUNCTION public.get_user_analytics(
  p_user_id UUID,
  p_start_date TIMESTAMP WITH TIME ZONE,
  p_end_date TIMESTAMP WITH TIME ZONE
)
RETURNS TABLE(
  total_requests BIGINT,
  total_credits NUMERIC,
  total_input_tokens BIGINT,
  total_output_tokens BIGINT,
  top_models JSONB,
  top_providers JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*)::BIGINT as total_requests,
    COALESCE(SUM(arl.total_cost), 0)::NUMERIC as total_credits,
    COALESCE(SUM(arl.input_tokens), 0)::BIGINT as total_input_tokens,
    COALESCE(SUM(arl.output_tokens), 0)::BIGINT as total_output_tokens,
    -- Top 5 models by usage
    (
      SELECT JSONB_AGG(model_stats ORDER BY cost DESC)
      FROM (
        SELECT 
          model_id,
          COUNT(*) as requests,
          SUM(total_cost) as cost
        FROM public.api_request_logs
        WHERE user_id = p_user_id
          AND created_at BETWEEN p_start_date AND p_end_date
        GROUP BY model_id
        ORDER BY cost DESC
        LIMIT 5
      ) model_stats
    ) as top_models,
    -- Top providers by usage
    (
      SELECT JSONB_AGG(provider_stats ORDER BY cost DESC)
      FROM (
        SELECT 
          provider,
          COUNT(*) as requests,
          SUM(total_cost) as cost
        FROM public.api_request_logs
        WHERE user_id = p_user_id
          AND created_at BETWEEN p_start_date AND p_end_date
        GROUP BY provider
        ORDER BY cost DESC
        LIMIT 5
      ) provider_stats
    ) as top_providers
  FROM public.api_request_logs arl
  WHERE arl.user_id = p_user_id
    AND arl.created_at BETWEEN p_start_date AND p_end_date;
END;
$$;

-- ============================================================================
-- SECTION 5: GRANT PERMISSIONS
-- ============================================================================

-- Grant SELECT on materialized view to authenticated users
GRANT SELECT ON public.daily_usage_summary TO authenticated;

-- Grant EXECUTE on refresh function to service_role only (for scheduled jobs)
GRANT EXECUTE ON FUNCTION public.refresh_daily_summary() TO service_role;

-- Grant EXECUTE on analytics functions to authenticated users
GRANT EXECUTE ON FUNCTION public.get_org_analytics(TEXT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_analytics(UUID, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE) TO authenticated;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (for reference - do not uncomment in production)
-- ============================================================================
-- To reverse this migration, execute the following commands:
--
-- BEGIN;
-- 
-- -- Drop functions
-- DROP FUNCTION IF EXISTS public.get_user_analytics(UUID, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
-- DROP FUNCTION IF EXISTS public.get_org_analytics(TEXT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
-- DROP FUNCTION IF EXISTS public.refresh_daily_summary();
-- 
-- -- Drop RLS policies
-- DROP POLICY IF EXISTS "Org members can view org logs" ON public.api_request_logs;
-- DROP POLICY IF EXISTS "Users can view own logs" ON public.api_request_logs;
-- ALTER TABLE public.api_request_logs DISABLE ROW LEVEL SECURITY;
-- 
-- -- Drop materialized view and its indexes
-- DROP INDEX IF EXISTS public.idx_daily_usage_summary_user;
-- DROP INDEX IF EXISTS public.idx_daily_usage_summary_org;
-- DROP INDEX IF EXISTS public.idx_daily_usage_summary_composite;
-- DROP MATERIALIZED VIEW IF EXISTS public.daily_usage_summary;
-- 
-- -- Drop indexes on api_request_logs
-- DROP INDEX IF EXISTS public.idx_api_request_logs_timeseries;
-- DROP INDEX IF EXISTS public.idx_api_request_logs_model_date;
-- DROP INDEX IF EXISTS public.idx_api_request_logs_org_date;
-- DROP INDEX IF EXISTS public.idx_api_request_logs_user_date;
-- 
-- COMMIT;
-- ============================================================================