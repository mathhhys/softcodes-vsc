/**
 * Auth Demo - Quick Test Runner for Supabase Auth Integration
 *
 * Run this file to quickly test your Supabase auth setup
 */

import { verifyJWTUserInSupabase, testUserIdInSupabase } from "./supabaseUserVerification"
import { parseJWTUnsafe } from "./jwtUtils"

// Your Supabase configuration (already set)
const CONFIG = {
	supabaseUrl:
		process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xraquejellmoyrpqcirs.supabase.co",
	supabaseKey:
		process.env.SUPABASE_SERVICE_ROLE_KEY ||
		"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyYXF1ZWplbGxtb3lycHFjaXJzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzEyMDkxOCwiZXhwIjoyMDY4Njk2OTE4fQ.zIsulv4FaY704Y4HW9HH3B1Hn02DRalLIf5bSR4JO5s",
}

// Sample JWT token from your auth flow (this contains your user data)
const SAMPLE_JWT =
	"eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18yV2ZOcTN4V01tVUNTS0RXM2wwdTVVNXQ2aDciLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL3NvZnRjb2Rlcy5haSIsImV4cCI6MTczNTgyMDMwMCwiaWF0IjoxNzM1ODIwMjQwLCJpc3MiOiJodHRwczovL2NsZXJrLnNvZnRjb2Rlcy5haSIsIm5iZiI6MTczNTgyMDIzMCwic2lkIjoic2Vzc181MDA2ZWE0ODM4MjZkNGI1ZGU3OWI1ZDg0YTY2ZDNlZiIsInN1YiI6InVzZXJfMzF2ZHc3YzlCQVlDSEdISWdnZlRiSnVVUklTIiwidXNlcm5hbWUiOiJtYXRoeXNndWlsbG91IiwiZW1haWwiOiJtYXRoeXNAc29mdGNvZGVzLmlvIn0.signature"

/**
 * Demo 1: Test Supabase Connection
 */
export async function testSupabaseConnection(): Promise<void> {
	console.log("\n🔌 DEMO 1: Testing Supabase Connection...")
	console.log("=".repeat(50))

	try {
		console.log("📊 Configuration Check:")
		console.log(`  - Supabase URL: ${CONFIG.supabaseUrl}`)
		console.log(`  - Service Key: ${CONFIG.supabaseKey ? "Configured ✅" : "Missing ❌"}`)

		console.log("\n🔍 Testing connection with dummy user lookup...")
		const result = await testUserIdInSupabase("connection_test_user")

		if (result.success) {
			console.log("✅ Supabase connection successful!")
			console.log("📝 Connection details:", {
				connected: true,
				userSearchWorking: true,
				error: result.error || "None",
			})
		} else {
			console.log("❌ Supabase connection failed")
			console.log("📝 Error details:", result.error)
		}
	} catch (error) {
		console.error("❌ Connection test failed with exception:", error)
	}
}

/**
 * Demo 2: Test JWT Token Parsing
 */
export async function testJWTProcessing(): Promise<string | undefined> {
	console.log("\n🎫 DEMO 2: Testing JWT Token Processing...")
	console.log("=".repeat(50))

	try {
		console.log("📝 Parsing sample JWT token...")
		const parseResult = parseJWTUnsafe(SAMPLE_JWT)

		if (parseResult.success && parseResult.parts) {
			console.log("✅ JWT parsing successful!")
			console.log("📊 Extracted data:")
			console.log(`  - User ID (clerk_id): ${parseResult.parts.payload.sub}`)
			console.log(`  - Email: ${parseResult.parts.payload.email}`)
			console.log(`  - Username: ${parseResult.parts.payload.username}`)
			console.log(`  - Session ID: ${parseResult.parts.payload.session_id}`)
			console.log(`  - Issuer: ${parseResult.parts.payload.iss}`)
			console.log(`  - Expires: ${new Date(parseResult.parts.payload.exp * 1000).toLocaleString()}`)

			return parseResult.parts.payload.sub
		} else {
			console.log("❌ JWT parsing failed")
			console.log("📝 Error:", parseResult.error)
			return undefined
		}
	} catch (error) {
		console.error("❌ JWT processing failed with exception:", error)
		return undefined
	}
}

/**
 * Demo 3: Test User Lookup in Supabase
 */
export async function testUserLookup(clerkId: string = "user_31vdw7c9BAYCHGHIggfTbJuURIS"): Promise<void> {
	console.log("\n👤 DEMO 3: Testing User Lookup in Supabase...")
	console.log("=".repeat(50))

	try {
		console.log(`🔍 Looking up user: ${clerkId}`)
		const startTime = Date.now()
		const result = await testUserIdInSupabase(clerkId)
		const responseTime = Date.now() - startTime

		console.log(`⏱️ Query completed in ${responseTime}ms`)

		if (result.success) {
			if (result.userExistsInSupabase) {
				console.log("✅ User found in Supabase database!")
				console.log("👤 User details:")
				console.log(`  - ID: ${result.userDetails.id}`)
				console.log(`  - Clerk ID: ${result.userDetails.clerk_id}`)
				console.log(`  - Email: ${result.userDetails.email}`)
				console.log(`  - First Name: ${result.userDetails.first_name || "Not set"}`)
				console.log(`  - Last Name: ${result.userDetails.last_name || "Not set"}`)
				console.log(`  - Plan Type: ${result.userDetails.plan_type || "Not set"}`)
				console.log(`  - Credits: ${result.userDetails.credits || 0}`)
				console.log(`  - Created: ${new Date(result.userDetails.created_at).toLocaleString()}`)
				console.log(`  - Updated: ${new Date(result.userDetails.updated_at).toLocaleString()}`)

				if (result.userDetails.vscode_session_id) {
					console.log(`  - VSCode Session: ${result.userDetails.vscode_session_id}`)
				}
				if (result.userDetails.last_vscode_login) {
					console.log(
						`  - Last VSCode Login: ${new Date(result.userDetails.last_vscode_login).toLocaleString()}`,
					)
				}
			} else {
				console.log("ℹ️ User not found in Supabase database")
				console.log("📝 This might be expected if the user hasn't been synced from Clerk yet")
			}
		} else {
			console.log("❌ User lookup failed")
			console.log("📝 Error:", result.error)
		}
	} catch (error) {
		console.error("❌ User lookup failed with exception:", error)
	}
}

/**
 * Demo 4: Complete Auth Flow Test (JWT → Supabase)
 */
export async function testCompleteAuthFlow(): Promise<void> {
	console.log("\n🔄 DEMO 4: Testing Complete Auth Flow...")
	console.log("=".repeat(50))

	try {
		console.log("🎫 Starting JWT → Supabase verification flow...")
		const startTime = Date.now()

		const result = await verifyJWTUserInSupabase(SAMPLE_JWT)
		const responseTime = Date.now() - startTime

		console.log(`⏱️ Complete flow completed in ${responseTime}ms`)

		if (result.success) {
			console.log("✅ Complete auth flow successful!")
			console.log("📊 Flow results:")
			console.log(`  - JWT parsed: ✅`)
			console.log(`  - User ID extracted: ${result.userIdExtracted}`)
			console.log(`  - User exists in Supabase: ${result.userExistsInSupabase ? "✅" : "❌"}`)

			if (result.userExistsInSupabase && result.userDetails) {
				console.log("👤 Verified user data:")
				console.log(`  - Email: ${result.userDetails.email}`)
				console.log(`  - Plan: ${result.userDetails.plan_type}`)
				console.log(`  - Credits: ${result.userDetails.credits}`)
			}
		} else {
			console.log("❌ Complete auth flow failed")
			console.log("📝 Error:", result.error)
		}
	} catch (error) {
		console.error("❌ Complete auth flow failed with exception:", error)
	}
}

/**
 * Demo 5: Test Different User Scenarios
 */
export async function testUserScenarios(): Promise<void> {
	console.log("\n🧪 DEMO 5: Testing Different User Scenarios...")
	console.log("=".repeat(50))

	const testCases = [
		{ name: "Known User", clerkId: "user_31vdw7c9BAYCHGHIggfTbJuURIS" },
		{ name: "Non-existent User", clerkId: "user_does_not_exist_12345" },
		{ name: "Invalid Format", clerkId: "invalid_user_id" },
		{ name: "Empty String", clerkId: "" },
	]

	for (const testCase of testCases) {
		console.log(`\n🔍 Testing: ${testCase.name}`)
		console.log(`   User ID: ${testCase.clerkId || "(empty)"}`)

		try {
			const result = await testUserIdInSupabase(testCase.clerkId)

			if (result.success) {
				console.log(`   Result: ${result.userExistsInSupabase ? "User exists ✅" : "User not found ℹ️"}`)
			} else {
				console.log(`   Result: Error - ${result.error}`)
			}
		} catch (error) {
			console.log(`   Result: Exception - ${error}`)
		}
	}
}

/**
 * Run All Demos
 */
export async function runAllDemos(): Promise<void> {
	console.log("🚀 SUPABASE AUTH INTEGRATION DEMO")
	console.log("🚀 Testing your complete auth setup...")
	console.log("=".repeat(60))

	try {
		// Demo 1: Test connection
		await testSupabaseConnection()

		// Demo 2: Test JWT processing
		const userId = await testJWTProcessing()

		// Demo 3: Test user lookup
		await testUserLookup(userId || "user_31vdw7c9BAYCHGHIggfTbJuURIS")

		// Demo 4: Test complete flow
		await testCompleteAuthFlow()

		// Demo 5: Test edge cases
		await testUserScenarios()

		console.log("\n🎉 DEMO COMPLETED!")
		console.log("=".repeat(60))
		console.log("✅ Your Supabase auth integration is ready for testing!")
		console.log("📝 Check the logs above for any issues that need attention.")
	} catch (error) {
		console.error("\n❌ DEMO FAILED!")
		console.error("Error:", error)
	}
}

/**
 * Quick Test Function - Call this for immediate testing
 */
export async function quickTest(): Promise<void> {
	console.log("⚡ QUICK AUTH TEST")
	console.log("=".repeat(30))

	// Test 1: Connection
	console.log("1️⃣ Testing connection...")
	const connectionResult = await testUserIdInSupabase("test_user")
	console.log(`   Connection: ${connectionResult.success ? "✅" : "❌"}`)

	// Test 2: JWT parsing
	console.log("2️⃣ Testing JWT parsing...")
	const jwtResult = parseJWTUnsafe(SAMPLE_JWT)
	console.log(`   JWT parsing: ${jwtResult.success ? "✅" : "❌"}`)
	console.log(`   User ID: ${jwtResult.parts?.payload.sub || "Failed to extract"}`)

	// Test 3: User lookup
	console.log("3️⃣ Testing user lookup...")
	if (jwtResult.success && jwtResult.parts?.payload.sub) {
		const userResult = await testUserIdInSupabase(jwtResult.parts.payload.sub)
		console.log(`   User lookup: ${userResult.success ? "✅" : "❌"}`)
		console.log(`   User exists: ${userResult.userExistsInSupabase ? "✅" : "❌"}`)
	}

	console.log("\n⚡ Quick test completed!")
}

// Export for easy import and testing
export default {
	testSupabaseConnection,
	testJWTProcessing,
	testUserLookup,
	testCompleteAuthFlow,
	testUserScenarios,
	runAllDemos,
	quickTest,
}
