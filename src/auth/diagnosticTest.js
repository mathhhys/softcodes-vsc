// Simple diagnostic test to check Supabase connection
const { createClient } = require("@supabase/supabase-js")

const supabaseUrl = "https://xraquejellmoyrpqcirs.supabase.co"
const supabaseKey =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyYXF1ZWplbGxtb3lycHFjaXJzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MzEyMDkxOCwiZXhwIjoyMDY4Njk2OTE4fQ.zIsulv4FaY704Y4HW9HH3B1Hn02DRalLIf5bSR4JO5s"

console.log("🔍 Diagnostic Test - Supabase Connection")
console.log("URL:", supabaseUrl)
console.log("Key length:", supabaseKey.length)

async function testConnection() {
	try {
		console.log("\n1. Creating Supabase client...")
		const supabase = createClient(supabaseUrl, supabaseKey)
		console.log("✅ Client created successfully")

		console.log("\n2. Testing connection with simple query...")
		const testUserId = "test_diagnostic_user"

		const { data, error, count } = await supabase
			.from("users")
			.select("*", { count: "exact" })
			.eq("clerk_id", testUserId)
			.single()

		console.log("\n3. Query results:")
		console.log("   Data:", data)
		console.log("   Error:", error)
		console.log("   Count:", count)

		if (error) {
			console.log("\n📊 Error Analysis:")
			console.log("   Code:", error.code)
			console.log("   Message:", error.message)
			console.log("   Details:", error.details)
			console.log("   Hint:", error.hint)

			if (error.code === "PGRST116") {
				console.log("\n✅ PGRST116 = No rows found (this is expected for test user)")
				console.log("✅ Connection is working! User just doesn't exist.")
				return { success: true, connectionWorking: true, userExists: false }
			} else {
				console.log("\n❌ Unexpected error - connection might be failing")
				return { success: false, connectionWorking: false, error: error }
			}
		}

		if (data) {
			console.log("\n✅ User found!")
			return { success: true, connectionWorking: true, userExists: true, data }
		}

		return { success: true, connectionWorking: true }
	} catch (err) {
		console.log("\n❌ Exception occurred:")
		console.log("   Error:", err.message)
		console.log("   Stack:", err.stack)
		return { success: false, connectionWorking: false, exception: err }
	}
}

testConnection()
	.then((result) => {
		console.log("\n🎯 Final Result:", JSON.stringify(result, null, 2))
	})
	.catch((err) => {
		console.log("\n💥 Test failed with exception:", err)
	})
