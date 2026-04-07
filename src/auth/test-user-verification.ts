/**
 * Test script to diagnose user verification issues
 * Run this to test user lookup in Supabase
 */

const { testUserIdInSupabase } = require("./supabaseUserVerification")

/**
 * Test user verification with a specific user ID
 * Replace 'YOUR_USER_ID_HERE' with the actual Clerk user ID
 */
export async function runUserVerificationTest() {
	console.log("🔍 Starting user verification diagnostic test...")

	// Replace this with the actual user ID from your JWT or Clerk dashboard
	const testUserId = process.env.TEST_USER_ID || "user_32mSltWx9KkUkJe3sN2Bkym2w45"

	console.log(`Testing user ID: ${testUserId}`)

	try {
		const result = await testUserIdInSupabase(testUserId)

		console.log("📊 Test Results:", {
			success: result.success,
			userExists: result.userExistsInSupabase,
			userIdExtracted: result.userIdExtracted,
			hasUserDetails: !!result.userDetails,
			error: result.error,
		})

		if (result.userDetails) {
			console.log("👤 User Details:", {
				id: result.userDetails.id,
				clerk_id: result.userDetails.clerk_id,
				email: result.userDetails.email,
				created_at: result.userDetails.created_at,
			})
		}

		return result
	} catch (error) {
		console.error("❌ Test failed:", error)
		return { success: false, error: String(error) }
	}
}

// Auto-run if this file is executed directly
if (require.main === module) {
	runUserVerificationTest()
		.then(() => {
			console.log("✅ Test completed")
			process.exit(0)
		})
		.catch((error) => {
			console.error("❌ Test failed:", error)
			process.exit(1)
		})
}
