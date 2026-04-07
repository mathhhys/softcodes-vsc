// Test the exact same call as the failing test
const { testUserIdInSupabase } = require("./supabaseUserVerification.ts")

console.log("🔍 Testing exact same call as failing test...")

async function runTest() {
	try {
		console.log('Calling testUserIdInSupabase with "test_connection_user"...')
		const result = await testUserIdInSupabase("test_connection_user")

		console.log("\n📊 Complete Result:")
		console.log(JSON.stringify(result, null, 2))

		console.log("\n🔍 Key Properties:")
		console.log("  success:", result.success)
		console.log("  userIdExtracted:", result.userIdExtracted)
		console.log("  userExistsInSupabase:", result.userExistsInSupabase)
		console.log("  error:", result.error)

		console.log("\n✅ Test Result:", result.success ? "PASS" : "FAIL")
	} catch (err) {
		console.log("\n❌ Exception occurred:")
		console.log("  Error:", err.message)
		console.log("  Stack:", err.stack)
	}
}

runTest()
