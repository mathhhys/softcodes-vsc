-- ============================================================================
-- Function: deduct_credits (Unified Org/User)
-- ============================================================================
-- Atomic deduction from org (if p_org_id) or user. Fails if insufficient, no fallback.
-- Inserts txn with org_id (nullable), negative credits_amount for deduction.
-- RETURNS json {success: true}

CREATE OR REPLACE FUNCTION public.deduct_credits(
  p_org_id text DEFAULT null,
  p_user_id text,
  p_credits NUMERIC(10,2),
  p_usd NUMERIC(10,4)
) RETURNS json AS $$
DECLARE
  balance_before NUMERIC(10,2);
  balance_after NUMERIC(10,2);
  target_table text;
  target_id text;
  v_user_id UUID := p_user_id::UUID;
  v_org_id UUID;
BEGIN
  -- Parse org_id if provided
  IF p_org_id IS NOT NULL THEN
    v_org_id := p_org_id::UUID;
    SELECT total_credits INTO balance_before FROM public.organizations WHERE id = v_org_id FOR UPDATE;
    IF NOT FOUND OR balance_before < p_credits THEN
      RAISE EXCEPTION 'Insufficient org credits. Required: %, Available: %', p_credits, COALESCE(balance_before, 0);
    END IF;
    UPDATE public.organizations SET 
      total_credits = total_credits - p_credits,
      credits_used = COALESCE(credits_used, 0) + p_credits,
      total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd,
      last_credit_update = NOW()
    WHERE id = v_org_id;
    balance_after := balance_before - p_credits;
    target_table := 'organization';
    target_id := p_org_id;
  ELSE
    SELECT credits INTO balance_before FROM public.users WHERE id = v_user_id FOR UPDATE;
    IF NOT FOUND OR balance_before < p_credits THEN
      RAISE EXCEPTION 'Insufficient user credits. Required: %, Available: %', p_credits, COALESCE(balance_before, 0);
    END IF;
    UPDATE public.users SET 
      credits = credits - p_credits,
      credits_used = COALESCE(credits_used, 0) + p_credits,
      total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd,
      last_credit_update = NOW()
    WHERE id = v_user_id;
    balance_after := balance_before - p_credits;
    target_table := 'users';
    target_id := p_user_id;
  END IF;

  -- Insert transaction (negative for deduction)
  INSERT INTO public.credit_transactions (
    user_id, org_id, operation_type, credits_amount, usd_amount,
    balance_before, balance_after, metadata
  ) VALUES (
    v_user_id, v_org_id, 'deduction', -p_credits, p_usd,
    balance_before, balance_after,
    jsonb_build_object('target_table', target_table, 'target_id', target_id)
  );

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permissions
GRANT EXECUTE ON FUNCTION public.deduct_credits TO service_role, authenticated;

COMMENT ON FUNCTION public.deduct_credits IS 
'Unified atomic credit deduction from organization (if p_org_id) or user. Fails on insufficient credits. Supports org_id in credit_transactions.';