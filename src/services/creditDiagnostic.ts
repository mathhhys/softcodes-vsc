/**
 * Credit System Diagnostic Tool
 *
 * Helps diagnose why credit balance retrieval is returning 0 instead of the expected amount
 */

import { getSupabaseServiceClient } from "./supabaseConfig"
import { parseJWTUnsafe } from "../auth/jwtUtils"

/**
 * Comprehensive credit diagnostic
 */
export async function diagnoseCreditIssue(jwtToken: string): Promise<{
	success: boolean
	diagnosis: string
	recommendations: string[]
	details: any
}> {
	console.log("[CREDIT-DIAGNOSTIC] Starting comprehensive credit diagnosis...")

	const results = {
		success: false,
		diagnosis: "",
		recommendations: [] as string[],
		details: {} as any,
	}

	try {
		// Step 1: Parse JWT to extract user information
		console.log("[CREDIT-DIAGNOSTIC] Step 1: Parsing JWT token...")
		const jwtParse = parseJWTUnsafe(jwtToken)

		if (!jwtParse.success) {
			results.diagnosis = "JWT parsing failed"
			results.recommendations.push("Check if JWT token is valid")
			return results
		}

		const payload = jwtParse.parts?.payload
		const clerkId = payload?.sub

		console.log("[CREDIT-DIAGNOSTIC] JWT parsed successfully:", {
			hasSub: !!clerkId,
			email: payload?.email,
			clerkId: clerkId?.substring(0, 20) + "...",
		})

		results.details.jwtInfo = {
			clerkId,
			email: payload?.email,
			exp: payload?.exp,
			iat: payload?.iat,
		}

		// Step 2: Test database connectivity
		console.log("[CREDIT-DIAGNOSTIC] Step 2: Testing database connectivity...")
		const supabase = await getSupabaseServiceClient()

		// Test basic connectivity
		const { data: testData, error: testError } = await supabase
			.from("users")
			.select("count", { count: "exact", head: true })
			.limit(1)

		if (testError) {
			results.diagnosis = "Database connectivity failed"
			results.recommendations.push("Check Supabase connection and permissions")
			results.details.dbError = testError
			return results
		}

		console.log("[CREDIT-DIAGNOSTIC] Database connectivity OK")

		// Step 3: Test credit function availability
		console.log("[CREDIT-DIAGNOSTIC] Step 3: Testing credit function availability...")
		const { data: funcData, error: funcError } = await supabase.rpc("get_user_credit_info", {
			p_clerk_id: clerkId,
		})

		results.details.functionCall = {
			calledWith: clerkId,
			response: funcData,
			error: funcError,
		}

		if (funcError) {
			if (funcError.message?.includes("function") && funcError.message?.includes("does not exist")) {
				results.diagnosis = "Credit database functions not deployed"
				results.recommendations.push("Deploy the credit schema to Supabase")
				results.recommendations.push("Run: node scripts/deploy-credit-schema.js")
				return results
			} else {
				results.diagnosis = "Credit function call failed"
				results.recommendations.push("Check function permissions and parameters")
				return results
			}
		}

		console.log("[CREDIT-DIAGNOSTIC] Credit function call result:", funcData)

		// Step 4: Analyze function response
		if (!funcData || !funcData.success) {
			if (funcData?.error === "user_not_found") {
				results.diagnosis = "User not found in database"
				results.recommendations.push("Ensure user is registered in the system")
				results.recommendations.push("Check if Clerk webhook has synced user data")
				results.recommendations.push("Verify clerk_id matches between JWT and database")
			} else {
				results.diagnosis = "Credit function returned error"
				results.recommendations.push("Check database function logs")
			}
			return results
		}

		// Step 5: Analyze credit data
		const creditInfo = funcData
		console.log("[CREDIT-DIAGNOSTIC] Credit info retrieved:", creditInfo)

		results.details.creditInfo = creditInfo

		if (creditInfo.current_credits === 0) {
			results.diagnosis = "User has 0 credits in database"
			results.recommendations.push("User needs to purchase credits")
			results.recommendations.push("Check if credits were properly added during registration")
			results.recommendations.push("Verify credit balance in Supabase dashboard")
		} else if (creditInfo.current_credits > 0) {
			results.diagnosis = "Credit retrieval working correctly"
			results.recommendations.push("No action needed - system working properly")
			results.success = true
		}

		// Step 6: Check for column name issues
		console.log("[CREDIT-DIAGNOSTIC] Step 6: Checking for column name issues...")

		// Try alternative column names
		const alternativeChecks = [
			{ column: "clerkId", description: "camelCase clerkId" },
			{ column: "user_id", description: "user_id column" },
			{ column: "id", description: "id column" },
		]

		for (const check of alternativeChecks) {
			try {
				const { data: altData, error: altError } = await supabase
					.from("users")
					.select("*")
					.eq(check.column, clerkId)
					.single()

				if (altData && !altError) {
					results.diagnosis = `Found user with ${check.description} instead of clerk_id`
					results.recommendations.push(`Update database function to use ${check.column} column`)
					results.recommendations.push("Or update user record to have correct clerk_id value")
					results.details.alternativeMatch = {
						column: check.column,
						data: altData,
					}
					break
				}
			} catch (e) {
				// Continue checking other columns
			}
		}

		// Step 7: Check sample users in database
		console.log("[CREDIT-DIAGNOSTIC] Step 7: Checking sample users in database...")
		const { data: sampleUsers, error: sampleError } = await supabase
			.from("users")
			.select("id, clerk_id, credits, email, created_at")
			.limit(5)

		results.details.sampleUsers = {
			data: sampleUsers,
			error: sampleError,
			count: sampleUsers?.length || 0,
		}

		if (sampleUsers && sampleUsers.length > 0) {
			console.log("[CREDIT-DIAGNOSTIC] Sample users found:", sampleUsers.length)

			// Check if our clerkId exists in any of the sample users
			const matchingUser = sampleUsers.find((user) => user.clerk_id === clerkId || user.id === clerkId)

			if (matchingUser) {
				results.details.matchingUser = matchingUser
				console.log("[CREDIT-DIAGNOSTIC] Found matching user:", matchingUser)
			} else {
				console.log("[CREDIT-DIAGNOSTIC] No matching user found in sample")
			}
		}

		return results
	} catch (error) {
		console.error("[CREDIT-DIAGNOSTIC] Diagnostic failed:", error)
		results.diagnosis = "Diagnostic process failed"
		results.recommendations.push("Check console logs for detailed error information")
		results.details.error = error
		return results
	}
}

/**
 * Quick credit balance check
 */
export async function quickCreditCheck(jwtToken: string): Promise<{
	credits: number
	error?: string
	details?: any
}> {
	try {
		const jwtParse = parseJWTUnsafe(jwtToken)
		if (!jwtParse.success) {
			return { credits: 0, error: "Invalid JWT token" }
		}

		const clerkId = jwtParse.parts?.payload?.sub
		if (!clerkId) {
			return { credits: 0, error: "No user ID in JWT" }
		}

		const supabase = await getSupabaseServiceClient()
		const { data, error } = await supabase.rpc("get_user_credit_info", {
			p_clerk_id: clerkId,
		})

		if (error) {
			return { credits: 0, error: error.message, details: error }
		}

		if (!data || !data.success) {
			return { credits: 0, error: data?.error || "User not found", details: data }
		}

		return { credits: data.current_credits || 0, details: data }
	} catch (error) {
		return { credits: 0, error: error instanceof Error ? error.message : String(error) }
	}
}

/**
 * Manual diagnostic runner for development
 */
export async function runManualDiagnostic(jwtToken?: string): Promise<void> {
	console.log("🔍 [MANUAL-DIAGNOSTIC] Starting manual credit diagnostic...")

	if (!jwtToken) {
		console.log("❌ [MANUAL-DIAGNOSTIC] No JWT token provided")
		console.log('💡 [MANUAL-DIAGNOSTIC] Usage: runManualDiagnostic("your_jwt_token_here")')
		return
	}

	try {
		const result = await diagnoseCreditIssue(jwtToken)

		console.log("📊 [MANUAL-DIAGNOSTIC] Diagnostic Results:")
		console.log("✅ Success:", result.success)
		console.log("🔍 Diagnosis:", result.diagnosis)
		console.log("💡 Recommendations:", result.recommendations)

		if (result.details) {
			console.log("📋 Details:", JSON.stringify(result.details, null, 2))
		}
	} catch (error) {
		console.error("❌ [MANUAL-DIAGNOSTIC] Manual diagnostic failed:", error)
	}
}
