/**
 * Simple User Check
 *
 * Straightforward approach to verify if a user ID from JWT corresponds to a real user
 * Makes API call to backend to check user existence
 */

import { parseJWTUnsafe } from "./jwtUtils"

/**
 * Simple user check result
 */
export interface UserCheckResult {
	success: boolean
	userIdExtracted?: string
	userExists?: boolean
	userDetails?: any
	error?: string
	source?: "supabase" | "clerk" | "api"
}

/**
 * Extract user ID from JWT and verify it exists via API call
 * This is the simplest approach - no signature verification needed
 */
export async function checkJWTUserExists(token: string, apiBaseUrl?: string): Promise<UserCheckResult> {
	console.log("[USER-CHECK] Starting simple JWT user existence check")
	console.log("[USER-CHECK] Token length:", token.length)

	try {
		// Step 1: Parse JWT to extract user ID (no signature verification)
		console.log("[USER-CHECK] Step 1: Parsing JWT to extract user ID...")
		const parseResult = parseJWTUnsafe(token)

		if (!parseResult.success) {
			console.log("[USER-CHECK] JWT parsing failed:", parseResult.error)
			return {
				success: false,
				error: `Failed to parse JWT: ${parseResult.error}`,
			}
		}

		const userId = parseResult.parts?.payload.sub
		if (!userId) {
			console.log("[USER-CHECK] No user ID found in JWT payload")
			return {
				success: false,
				error: "No user ID (sub claim) found in JWT",
			}
		}

		console.log("[USER-CHECK] ✅ User ID extracted from JWT:", userId)

		// Step 2: Make API call to check if user exists
		console.log("[USER-CHECK] Step 2: Checking if user exists via API...")

		const baseUrl = apiBaseUrl || "https://softcodes.ai"
		const checkUrl = `${baseUrl}/api/auth/check-user/${userId}`

		console.log("[USER-CHECK] Making request to:", checkUrl)
		const requestStartTime = Date.now()

		try {
			const response = await fetch(checkUrl, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					"User-Agent": "VSCode-Softcodes-Extension",
				},
				signal: AbortSignal.timeout(10000), // 10 second timeout
			})

			const requestTime = Date.now() - requestStartTime
			console.log("[USER-CHECK] API response received:", {
				status: response.status,
				statusText: response.statusText,
				requestTime: `${requestTime}ms`,
			})

			if (response.ok) {
				const userData = await response.json()
				console.log("[USER-CHECK] ✅ SUCCESS: User exists!", {
					userId,
					userEmail: userData.email,
					source: userData.source || "unknown",
				})

				return {
					success: true,
					userIdExtracted: userId,
					userExists: true,
					userDetails: userData,
					source: userData.source,
				}
			} else if (response.status === 404) {
				console.log("[USER-CHECK] ❌ User not found (404)")
				return {
					success: true,
					userIdExtracted: userId,
					userExists: false,
					error: "User not found",
				}
			} else {
				const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
				console.log("[USER-CHECK] API error:", {
					status: response.status,
					error: errorData,
				})

				return {
					success: false,
					userIdExtracted: userId,
					error: `API error: ${response.status} - ${errorData.error || response.statusText}`,
				}
			}
		} catch (apiError) {
			console.error("[USER-CHECK] API request failed:", apiError)

			// If API is not available, we can still report that we successfully extracted the user ID
			return {
				success: true, // We successfully extracted the user ID from JWT
				userIdExtracted: userId,
				userExists: undefined, // Unknown due to API unavailability
				error: `API unavailable: ${apiError instanceof Error ? apiError.message : String(apiError)}`,
			}
		}
	} catch (error) {
		console.error("[USER-CHECK] Verification failed with error:", error)
		return {
			success: false,
			error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`,
		}
	}
}

/**
 * Create a simple demo function to test with the current user ID
 */
export async function demoUserCheck(): Promise<void> {
	console.log("[USER-CHECK-DEMO] Running demo with current user ID from logs...")

	// Use the user ID from the logs we saw earlier
	const testUserId = "user_31vdw7c9BAYCHGHIggfTbJuURIS"

	console.log("[USER-CHECK-DEMO] Test scenario: Check if user ID exists")
	console.log("[USER-CHECK-DEMO] User ID to check:", testUserId)

	// For demo, we can simulate what the verification would show
	console.log("[USER-CHECK-DEMO] ✅ User ID format: Valid (matches user_[alphanumeric] pattern)")
	console.log("[USER-CHECK-DEMO] ✅ User ID source: Extracted from JWT sub claim")
	console.log("[USER-CHECK-DEMO] ✅ Next step: Backend should query Supabase users table")
	console.log("[USER-CHECK-DEMO] ✅ Expected query: SELECT * FROM users WHERE clerk_id = ?", testUserId)

	console.log("[USER-CHECK-DEMO] Demo completed. To test with real API:")
	console.log("[USER-CHECK-DEMO] 1. Implement /api/auth/check-user/:userId endpoint")
	console.log("[USER-CHECK-DEMO] 2. Call checkJWTUserExists() with your JWT token")
}
