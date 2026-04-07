-- ============================================================================
-- Table: api_request_logs
-- ============================================================================
-- Stores detailed logs of API requests for analytics and dashboarding.
-- This allows per-enterprise usage tracking even with shared API keys.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.api_request_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id),
    organization_id TEXT,
    organization_name TEXT,
    task_id TEXT,
    model_id TEXT,
    provider TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_cost NUMERIC(10, 6),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_api_request_logs_user_id ON public.api_request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_organization_id ON public.api_request_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_task_id ON public.api_request_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_api_request_logs_created_at ON public.api_request_logs(created_at);

-- Grant permissions
GRANT ALL ON public.api_request_logs TO service_role;
GRANT SELECT ON public.api_request_logs TO authenticated;

-- Add comment explaining the table
COMMENT ON TABLE public.api_request_logs IS 'Stores detailed logs of API requests for analytics and dashboarding, supporting per-enterprise usage tracking.';