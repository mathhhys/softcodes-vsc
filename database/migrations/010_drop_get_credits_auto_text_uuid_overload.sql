-- Migration: Drop ambiguous PostgREST RPC overload for get_credits_auto
-- Removes public.get_credits_auto(text, uuid) so only the UUID-based overload remains.

BEGIN;

DROP FUNCTION IF EXISTS public.get_credits_auto(text, uuid);

COMMIT;