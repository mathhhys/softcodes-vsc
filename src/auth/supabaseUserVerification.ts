/**
 * Supabase User Verification
 *
 * Simple approach to verify if a user ID from a JWT corresponds to a real user in Supabase
 * Supabase database is synced with Clerk via webhooks, so this is an effective verification method
 */

import { parseJWTUnsafe } from "./jwtUtils"

/**
 * Supabase verification result
 */
export interface SupabaseVerificationResult {
	success: boolean
	userIdExtracted?: string
	userExistsInSupabase?: boolean
	userDetails?: any
	error?: string
}

/**
 * Verify if JWT user ID corresponds to real user in Supabase
 * This queries the users table where clerk_id should match the JWT's sub claim
 */
export async function verifyJWTUserInSupabase(token: string): Promise<SupabaseVerificationResult> {
	console.log("[SUPABASE-VERIFY] Starting simple JWT user verification with Supabase")
	console.log("[SUPABASE-VERIFY] Token length:", token.length)

	try {
		// Step 1: Parse JWT to extract user ID (no signature verification needed)
		console.log("[SUPABASE-VERIFY] Step 1: Parsing JWT to extract user ID...")
		const parseResult = parseJWTUnsafe(token)

		if (!parseResult.success) {
			console.log("[SUPABASE-VERIFY] JWT parsing failed:", parseResult.error)
			return {
				success: false,
				error: `Failed to parse JWT: ${parseResult.error}`,
			}
		}

		const userId = parseResult.parts?.payload.sub
		if (!userId) {
			console.log("[SUPABASE-VERIFY] No user ID found in JWT payload")
			return {
				success: false,
				error: "No user ID (sub claim) found in JWT",
			}
		}

		console.log("[SUPABASE-VERIFY] User ID extracted from JWT:", userId)

		// Step 2: Check if user exists in Supabase
		console.log("[SUPABASE-VERIFY] Step 2: Checking if user exists in Supabase database...")

		// Initialize Supabase client
		const { createClient } = require("@supabase/supabase-js")
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
		const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

		if (!supabaseUrl || !supabaseKey) {
			console.error("[SUPABASE-VERIFY] Missing Supabase configuration:", {
				hasUrl: !!supabaseUrl,
				hasKey: !!supabaseKey,
			})
			return {
				success: false,
				userIdExtracted: userId,
				error: "Supabase configuration missing (URL or API key)",
			}
		}

		console.log("[SUPABASE-VERIFY] Initializing Supabase client...", {
			url: supabaseUrl,
			hasKey: !!supabaseKey,
		})

		const supabase = createClient(supabaseUrl, supabaseKey)

		// Query users table for the clerk_id
		console.log("[SUPABASE-VERIFY] Querying users table for clerk_id:", userId)
		const queryStartTime = Date.now()

		const { data, error, count } = await supabase
			.from("users")
			.select("*", { count: "exact" })
			.eq("clerk_id", userId)
			.single()

		const queryTime = Date.now() - queryStartTime

		console.log("[SUPABASE-VERIFY] Supabase query completed:", {
			userId,
			queryTime: `${queryTime}ms`,
			hasData: !!data,
			hasError: !!error,
			errorCode: error?.code,
			errorMessage: error?.message,
			count,
		})

		if (error) {
			if (error.code === "PGRST116") {
				// No rows found - user doesn't exist
				console.log("[SUPABASE-VERIFY] ❌ User NOT found in Supabase database")
				return {
					success: true, // Query succeeded, but user doesn't exist
					userIdExtracted: userId,
					userExistsInSupabase: false,
					error: "User not found in Supabase database",
				}
			} else {
				// Database error
				console.error("[SUPABASE-VERIFY] Database query failed:", error)
				return {
					success: false,
					userIdExtracted: userId,
					error: `Database query failed: ${error.message}`,
				}
			}
		}

		if (data) {
			console.log("[SUPABASE-VERIFY] ✅ SUCCESS: User ID from JWT corresponds to real user in Supabase")
			console.log("[SUPABASE-VERIFY] User details from Supabase:", {
				id: data.id,
				clerk_id: data.clerk_id,
				email: data.email,
				first_name: data.first_name,
				last_name: data.last_name,
				created_at: data.created_at,
				updated_at: data.updated_at,
			})

			return {
				success: true,
				userIdExtracted: userId,
				userExistsInSupabase: true,
				userDetails: data,
			}
		}

		// Should not reach here, but handle just in case
		console.log("[SUPABASE-VERIFY] Unexpected result: no data and no error")
		return {
			success: false,
			userIdExtracted: userId,
			error: "Unexpected database result",
		}
	} catch (error) {
		console.error("[SUPABASE-VERIFY] Verification failed with error:", error)
		return {
			success: false,
			error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Quick test function to verify a specific user ID in Supabase
 */
export async function testUserIdInSupabase(clerkUserId: string): Promise<SupabaseVerificationResult> {
	console.log("[SUPABASE-TEST] Testing user ID directly in Supabase:", clerkUserId)

	try {
		// Initialize Supabase client
		const { createClient } = require("@supabase/supabase-js")
		const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
		const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

		if (!supabaseUrl || !supabaseKey) {
			return {
				success: false,
				error: "Supabase configuration missing",
			}
		}

		const supabase = createClient(supabaseUrl, supabaseKey)

		const { data, error } = await supabase.from("users").select("*").eq("clerk_id", clerkUserId).single()

		if (error) {
			if (error.code === "PGRST116") {
				console.log("[SUPABASE-TEST] User not found in Supabase")
				return {
					success: true,
					userIdExtracted: clerkUserId,
					userExistsInSupabase: false,
				}
			}

			console.error("[SUPABASE-TEST] Database error:", error)
			return {
				success: false,
				userIdExtracted: clerkUserId,
				error: error.message,
			}
		}

		console.log("[SUPABASE-TEST] User found in Supabase:", data)
		return {
			success: true,
			userIdExtracted: clerkUserId,
			userExistsInSupabase: true,
			userDetails: data,
		}
	} catch (error) {
		console.error("[SUPABASE-TEST] Test failed:", error)
		return {
			success: false,
			userIdExtracted: clerkUserId,
			error: `Test failed: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}
