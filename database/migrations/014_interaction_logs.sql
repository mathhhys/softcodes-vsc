-- ============================================================================
-- Migration: 014_interaction_logs
-- ============================================================================
-- Creates a table to store general telemetry events and user interactions
-- directly in the database, replacing the need for external providers like PostHog.
-- ============================================================================

-- Create the interaction_logs table
CREATE TABLE IF NOT EXISTS public.interaction_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    machine_id TEXT, -- VSCode machine ID for anonymous tracking
    event_name TEXT NOT NULL,
    properties JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_interaction_logs_user_id ON public.interaction_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_interaction_logs_event_name ON public.interaction_logs(event_name);
CREATE INDEX IF NOT EXISTS idx_interaction_logs_created_at ON public.interaction_logs(created_at);

-- Enable Row Level Security
ALTER TABLE public.interaction_logs ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to see only their own logs
CREATE POLICY "Users can view their own interaction logs"
    ON public.interaction_logs
    FOR SELECT
    USING (auth.uid() = user_id);

-- Create policy to allow service role to manage all logs
CREATE POLICY "Service role can manage all interaction logs"
    ON public.interaction_logs
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create a function to log interactions via RPC (easier for the extension)
CREATE OR REPLACE FUNCTION public.log_interaction(
    p_event_name TEXT,
    p_properties JSONB DEFAULT '{}'::jsonb,
    p_machine_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_log_id UUID;
BEGIN
    -- Get user ID from auth context
    v_user_id := auth.uid();
    
    INSERT INTO public.interaction_logs (
        user_id,
        machine_id,
        event_name,
        properties
    ) VALUES (
        v_user_id,
        p_machine_id,
        p_event_name,
        p_properties
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$;

-- Grant execute permission to authenticated users and service role
GRANT EXECUTE ON FUNCTION public.log_interaction TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_interaction TO service_role;

-- Add comment
COMMENT ON TABLE public.interaction_logs IS 'Stores general telemetry events and user interactions for the analytics dashboard.';