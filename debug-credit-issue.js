#!/usr/bin/env node

/**
 * Debug Credit Issue Script
 *
 * Helps identify why credit balance is showing 0 instead of the expected amount
 * Run with: node debug-credit-issue.js
 */

const fs = require("fs")
const path = require("path")

// Load environment variables
require("dotenv").config()

async function debugCreditIssue() {
	console.log("🔍 Starting credit issue debugging...\n")

	// Check environment variables
	console.log("📋 Environment Variables:")
	console.log("  SUPABASE_URL:", process.env.SUPABASE_URL ? "✅ Set" : "❌ Missing")
	console.log("  SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "✅ Set" : "❌ Missing")
	console.log("  SUPABASE_ANON_KEY:", process.env.SUPABASE_ANON_KEY ? "✅ Set" : "❌ Missing")
	console.log()

	// Check if schema file exists
	const schemaPath = path.join(__dirname, "src", "database", "supabase-credit-schema.sql")
	console.log("📋 Database Schema:")
	console.log("  Schema file exists:", fs.existsSync(schemaPath) ? "✅ Yes" : "❌ No")
	console.log()

	// Instructions for user
	console.log("🔧 Next Steps:")
	console.log("1. Make sure your JWT token is valid and contains the correct user ID")
	console.log("2. Check if the credit schema has been deployed to your Supabase database")
	console.log("3. Verify that your user exists in the database with the correct clerk_id")
	console.log("4. Ensure your user has credits assigned in the database")
	console.log()

	console.log("🛠️  To deploy the credit schema, run:")
	console.log("  node scripts/deploy-credit-schema.js")
	console.log()

	console.log("🔍 To check your current credit balance manually:")
	console.log("  1. Go to your Supabase dashboard")
	console.log("  2. Open SQL Editor")
	console.log("  3. Run: SELECT * FROM users WHERE clerk_id = 'your_clerk_user_id';")
	console.log('  4. Check the "credits" column value')
	console.log()

	console.log("📊 To test the credit function:")
	console.log("  1. In Supabase SQL Editor, run:")
	console.log("     SELECT * FROM get_user_credit_info('your_clerk_user_id');")
	console.log()

	console.log("💡 Most common issues:")
	console.log("  • User not found in database (clerk_id mismatch)")
	console.log("  • Credit schema not deployed")
	console.log("  • User has 0 credits in database")
	console.log("  • JWT token expired or invalid")
	console.log()

	// Try to load and run the diagnostic if possible
	try {
		console.log("🚀 Attempting to run automated diagnostic...")

		// This would require the compiled TypeScript, so we'll provide manual steps
		console.log("⚠️  For automated diagnostic, you need to:")
		console.log("  1. Build the project: npm run compile")
		console.log("  2. Run the diagnostic with your JWT token")
		console.log()
	} catch (error) {
		console.log("ℹ️  Automated diagnostic not available yet")
	}
}

if (require.main === module) {
	debugCreditIssue().catch(console.error)
}

module.exports = { debugCreditIssue }
