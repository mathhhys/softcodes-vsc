/**
 * Supabase User Verification
 *
 * Simple approach to verify if a user ID from a JWT corresponds to a real user in Supabase
 * Supabase database is synced with Clerk via webhooks, so this is an effective verification method
 */

import { parseJWTUnsafe } from "./jwtUtils"
import { getSupabaseServiceClient } from "../services/supabaseConfig"

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
	console.log("[SUPABASE-VERIFY] Token length:", token?.length || 0)

	// Handle null/undefined token
	if (!token) {
		console.log("[SUPABASE-VERIFY] No token provided")
		return {
			success: false,
			error: "No token provided",
		}
	}

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

		const clerkId = parseResult.parts?.payload.sub
		if (!clerkId) {
			console.log("[SUPABASE-VERIFY] No user ID found in JWT payload")
			return {
				success: false,
				error: "No user ID (sub claim) found in JWT",
			}
		}

		console.log("[SUPABASE-VERIFY] Clerk user ID (sub) extracted from JWT:", clerkId)

		// Step 2: Check if user/org exists in Supabase using automatic context lookup
		console.log("[SUPABASE-VERIFY] Step 2: Checking user/org context in Supabase database...")

		// Use centralized Supabase configuration
		const supabase = await getSupabaseServiceClient()

		// Step 2: Extract context from JWT to pass to service_role RPC
		let orgId: string | undefined
		try {
			orgId = parseResult.parts?.payload.org_id
		} catch (e) {
			console.warn("[SUPABASE-VERIFY] Failed to extract org_id from JWT")
		}

		const looksLikeUuid = (value: unknown): boolean =>
			typeof value === "string" &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

		const formatUnknownError = (err: unknown): string => {
			if (err instanceof Error) return err.message
			if (typeof err === "object" && err && "message" in err) return String((err as any).message)
			return String(err)
		}

		// Step 2a: Map Clerk identifier (JWT sub) -> internal users.id (uuid)
		let internalUserId: string
		try {
			const { data: mappedUser, error: mappedUserError } = await supabase
				.from("users")
				.select("id")
				.eq("clerk_id", clerkId)
				.single()

			if (mappedUserError) {
				// PGRST116: no rows (user not found)
				if (mappedUserError.code === "PGRST116") {
					console.log("[SUPABASE-VERIFY] ❌ No Supabase user row found for clerk_id:", clerkId)
					return {
						success: true,
						userIdExtracted: clerkId,
						userExistsInSupabase: false,
						error: "User not found in Supabase database",
					}
				}

				console.error("[SUPABASE-VERIFY] Failed to map clerk_id to users.id:", mappedUserError)
				return {
					success: false,
					userIdExtracted: clerkId,
					error: `Database query failed: ${mappedUserError.message}`,
				}
			}

			if (!mappedUser?.id) {
				console.log("[SUPABASE-VERIFY] ❌ Supabase user mapping returned no id for clerk_id:", clerkId)
				return {
					success: true,
					userIdExtracted: clerkId,
					userExistsInSupabase: false,
					error: "User not found in Supabase database",
				}
			}

			internalUserId = String(mappedUser.id)
		} catch (mappingError) {
			console.error("[SUPABASE-VERIFY] Failed to map clerk_id to users.id (exception):", mappingError)
			return {
				success: false,
				userIdExtracted: clerkId,
				error: `Database query failed: ${formatUnknownError(mappingError)}`,
			}
		}

		console.log("[SUPABASE-VERIFY] Mapped clerk_id to internal users.id:", {
			clerkId,
			internalUserId,
			internalUserIdLooksLikeUuid: looksLikeUuid(internalUserId),
		})

		console.log(`[SUPABASE-VERIFY] Calling get_credits_auto(user: ${internalUserId}, org: ${orgId || "none"})`)
		console.log("[SUPABASE-VERIFY] get_credits_auto() RPC params (debug):", {
			p_clerk_id: clerkId,
			p_user_id: internalUserId,
			p_user_id_type: typeof internalUserId,
			p_user_id_looks_like_uuid: looksLikeUuid(internalUserId),
			p_org_id: orgId,
			p_org_id_type: typeof orgId,
			p_org_id_looks_like_uuid: looksLikeUuid(orgId),
			using_service_role_client: true,
		})

		const queryStartTime = Date.now()

		let data: any
		let error: any
		try {
			// Cast parameters explicitly to ensure PostgreSQL function signature match
			// null must be passed as null, not undefined, for proper UUID type matching
			const rpcResult = await supabase.rpc("get_credits_auto", {
				p_user_id: internalUserId,
				p_org_id: orgId || null,
			})
			data = rpcResult.data
			error = rpcResult.error
		} catch (rpcException) {
			console.error("[SUPABASE-VERIFY] RPC call threw an exception:", rpcException)
			return {
				success: false,
				userIdExtracted: clerkId,
				error: `Database query failed: ${formatUnknownError(rpcException)}`,
			}
		}

		const queryTime = Date.now() - queryStartTime

		const errorDetailsForLogs = error ? JSON.stringify(error, Object.getOwnPropertyNames(error)) : undefined

		console.log("[SUPABASE-VERIFY] Supabase query completed:", {
			clerkId,
			internalUserId,
			queryTime: `${queryTime}ms`,
			hasData: !!data,
			hasError: !!error,
			errorCode: error?.code,
			errorMessage: error?.message,
			errorDetails: errorDetailsForLogs,
		})

		if (error) {
			const isUuidError = error.code === "22P02" || error.message?.includes("uuid")
			const isOverloadAmbiguity = error.message?.includes("Could not choose the best candidate function")

			console.log("[SUPABASE-VERIFY] Error classification (debug):", {
				isUuidError,
				isOverloadAmbiguity,
			})
		}

		if (error) {
			// Database error
			console.error("[SUPABASE-VERIFY] Database query failed:", error)
			return {
				success: false,
				userIdExtracted: clerkId,
				error: `Database query failed: ${error.message}`,
			}
		}

		if (data && data.success) {
			console.log("[SUPABASE-VERIFY] ✅ SUCCESS: Context-aware user data retrieved")
			console.log("[SUPABASE-VERIFY] Details:", {
				user_id: data.user_id,
				org_id: data.org_id,
				is_organization: data.is_organization,
				credits: data.current_credits,
				plan_type: data.plan_type,
			})

			// Map the response to the expected userDetails format
			// We rename current_credits to credits for compatibility with existing UI
			const userDetails = {
				...data,
				credits: data.current_credits,
				id: data.user_id, // Ensure ID is present for tracking
			}

			return {
				success: true,
				userIdExtracted: clerkId,
				userExistsInSupabase: true,
				userDetails: userDetails,
			}
		} else {
			// Function returned success: false or user not found
			console.log("[SUPABASE-VERIFY] ❌ User/Org NOT found or unauthorized:", data?.message)
			return {
				success: true,
				userIdExtracted: clerkId,
				userExistsInSupabase: false,
				error: data?.message || "User not found in Supabase database",
			}
		}

		// Should not reach here, but handle just in case
		console.log("[SUPABASE-VERIFY] Unexpected result: no data and no error")
		return {
			success: false,
			userIdExtracted: clerkId,
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
 * Usage: await testUserIdInSupabase("user_1234567890")
 * This function tries multiple column names to find the user
 */
export async function testUserIdInSupabase(clerkUserId: string): Promise<SupabaseVerificationResult> {
	console.log("[SUPABASE-TEST] Testing user ID directly in Supabase:", clerkUserId)

	try {
		// Use centralized Supabase configuration
		const supabase = await getSupabaseServiceClient()

		// Try multiple column names to find the user
		const columnNames = ["clerk_id", "clerkId", "user_id", "id"]

		for (const columnName of columnNames) {
			console.log(`[SUPABASE-TEST] Trying column '${columnName}' for user ID: ${clerkUserId}`)

			const { data, error } = await supabase.from("users").select("*").eq(columnName, clerkUserId).single()

			if (data && !error) {
				console.log(`[SUPABASE-TEST] ✅ User found with column '${columnName}':`, data)
				return {
					success: true,
					userIdExtracted: clerkUserId,
					userExistsInSupabase: true,
					userDetails: data,
				}
			}

			if (error && error.code !== "PGRST116") {
				console.log(`[SUPABASE-TEST] Error with column '${columnName}':`, error.message)
			}
		}

		// If we get here, user wasn't found with any column name
		console.log("[SUPABASE-TEST] User not found with any column name, checking table structure...")

		// Get sample users to see what columns exist
		const { data: sampleUsers, error: sampleError } = await supabase.from("users").select("*").limit(3)

		if (sampleUsers && sampleUsers.length > 0) {
			console.log("[SUPABASE-TEST] Sample user structure:", Object.keys(sampleUsers[0]))
			console.log("[SUPABASE-TEST] Sample user data:", sampleUsers[0])
		} else {
			console.log("[SUPABASE-TEST] No users found in table or error:", sampleError?.message)
		}

		return {
			success: true,
			userIdExtracted: clerkUserId,
			userExistsInSupabase: false,
			error: "User not found in Supabase with any column name",
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
