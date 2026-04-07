-- ============================================================================
-- Migration: 015_add_org_id_to_interaction_logs
-- ============================================================================
-- Adds organization_id to interaction_logs to support organization-level
-- analytics and updates the log_interaction function to handle it.
-- ============================================================================

BEGIN;

-- 1. Add organization_id column to interaction_logs
ALTER TABLE public.interaction_logs 
ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- 2. Add index for organization-specific queries
CREATE INDEX IF NOT EXISTS idx_interaction_logs_org_id 
ON public.interaction_logs(organization_id) 
WHERE organization_id IS NOT NULL;

-- 3. Update RLS policy to allow organization members to see org logs
-- Note: We keep the existing "Users can view their own interaction logs" policy
DROP POLICY IF EXISTS "Org members can view org interaction logs" ON public.interaction_logs;
CREATE POLICY "Org members can view org interaction logs"
ON public.interaction_logs
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

-- 4. Update the log_interaction function to accept org_id
CREATE OR REPLACE FUNCTION public.log_interaction(
    p_event_name TEXT,
    p_properties JSONB DEFAULT '{}'::jsonb,
    p_machine_id TEXT DEFAULT NULL,
    p_org_id TEXT DEFAULT NULL -- New parameter
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
        organization_id,
        machine_id,
        event_name,
        properties
    ) VALUES (
        v_user_id,
        p_org_id,
        p_machine_id,
        p_event_name,
        p_properties
    ) RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$;

COMMIT;