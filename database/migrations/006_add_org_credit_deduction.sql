-- Migration: Add Organization Credit Deduction RPCs
-- Enables direct org deduction/balance if JWT.org_id present
-- Mirrors user RPCs for consistency

BEGIN;

-- 1. get_org_credit_info - balance lookup
CREATE OR REPLACE FUNCTION public.get_org_credit_info(p_org_id UUID)
RETURNS TABLE (
  success BOOLEAN,
  org_id UUID,
  current_credits NUMERIC(10,2),
  credits_used NUMERIC(10,2),
  total_spent_usd NUMERIC(10,4),
  plan_type TEXT,
  last_credit_update TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    true as success,
    id as org_id,
    total_credits as current_credits,
    credits_used,
    total_spent_usd,
    plan_type,
    last_credit_update
  FROM public.organizations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      false, NULL::UUID, 0.00, 0.00, 0.0000, 'free', NULL::TIMESTAMPTZ;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. deduct_org_credits - atomic deduction
CREATE OR REPLACE FUNCTION public.deduct_org_credits(
  p_org_id UUID,
  p_credits_to_deduct NUMERIC(10,2),
  p_usd_amount NUMERIC(10,4),
  p_description TEXT DEFAULT 'Org credit deduction',
  p_metadata JSONB DEFAULT '{}'
)
RETURNS TABLE (
  success BOOLEAN,
  credits_deducted NUMERIC(10,2),
  balance_before NUMERIC(10,2),
  balance_after NUMERIC(10,2),
  usd_amount NUMERIC(10,4),
  transaction_id UUID,
  org_id UUID,
  error TEXT,
  message TEXT
) AS $$
DECLARE
  v_balance_before NUMERIC(10,2);
  v_balance_after NUMERIC(10,2);
  v_tx_id UUID := gen_random_uuid();
BEGIN
  -- Lock the organization row for atomicity
  PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE NOWAIT;
  
  -- Get current balance
  SELECT total_credits INTO v_balance_before
  FROM public.organizations
  WHERE id = p_org_id;
  
  -- Check sufficient credits
  IF COALESCE(v_balance_before, 0) < p_credits_to_deduct THEN
    RETURN QUERY SELECT 
      false as success,
      NULL::NUMERIC(10,2) as credits_deducted,
      v_balance_before as balance_before,
      NULL::NUMERIC(10,2) as balance_after,
      p_usd_amount as usd_amount,
      NULL::UUID as transaction_id,
      p_org_id as org_id,
      'insufficient_credits' as error,
      format('Insufficient credits. Required: %s, Available: %s', p_credits_to_deduct, v_balance_before) as message;
    RETURN;
  END IF;

  -- Deduct credits
  UPDATE public.organizations
  SET
    total_credits = total_credits - p_credits_to_deduct,
    credits_used = COALESCE(credits_used, 0) + p_credits_to_deduct,
    total_spent_usd = COALESCE(total_spent_usd, 0) + p_usd_amount,
    last_credit_update = NOW()
  WHERE id = p_org_id
  RETURNING total_credits INTO v_balance_after;

  -- Return success
  RETURN QUERY SELECT 
    true as success,
    p_credits_to_deduct as credits_deducted,
    v_balance_before as balance_before,
    v_balance_after as balance_after,
    p_usd_amount as usd_amount,
    v_tx_id as transaction_id,
    p_org_id as org_id,
    NULL::TEXT as error,
    'Credit deduction successful' as message;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;