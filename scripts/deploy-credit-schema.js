#!/usr/bin/env node

/**
 * Credit Schema Deployment Script
 *
 * Provides instructions for deploying the credit management schema to Supabase
 * Run with: node scripts/deploy-credit-schema.js
 */

const fs = require("fs")
const path = require("path")

function showManualInstructions() {
	console.log("🚀 Credit Schema Deployment Instructions")
	console.log("=".repeat(50))
	console.log("")
	console.log("📋 MANUAL DEPLOYMENT REQUIRED")
	console.log("")
	console.log("1. 📱 Go to your Supabase Dashboard:")
	console.log("   https://supabase.com/dashboard/project/xraquejellmoyrpqcirs")
	console.log("")
	console.log("2. 🗃️ Navigate to SQL Editor")
	console.log('   • Click "SQL Editor" in the left sidebar')
	console.log('   • Click "New Query"')
	console.log("")
	console.log("3. 📄 Copy and paste the schema:")
	console.log("   • Copy the entire contents below")
	console.log("   • Paste into the SQL Editor")
	console.log('   • Click "Run" or "Run selected"')
	console.log("")
	console.log("📝 SCHEMA SQL:")
	console.log("-".repeat(30))

	try {
		const schemaPath = path.join(__dirname, "..", "src", "database", "supabase-credit-schema.sql")
		const schemaSQL = fs.readFileSync(schemaPath, "utf8")
		console.log(schemaSQL)
	} catch (error) {
		console.error("❌ Could not read schema file:", error.message)
		console.log("Please manually copy from: src/database/supabase-credit-schema.sql")
	}

	console.log("")
	console.log("=".repeat(50))
	console.log("✅ WHAT THIS SCHEMA CREATES:")
	console.log("")
	console.log("🗂️  TABLES:")
	console.log("  • credit_transactions - Complete audit trail for all credit operations")
	console.log("")
	console.log("🛠️  FUNCTIONS:")
	console.log("  • get_user_credit_info(p_clerk_id) - Get user credit balance")
	console.log("  • deduct_user_credits(user_id, credits, usd_amount, description) - Atomic deduction")
	console.log("  • add_user_credits(user_id, credits, usd_amount, operation_type) - Add credits")
	console.log("")
	console.log("🔒 SECURITY:")
	console.log("  • Row Level Security (RLS) policies")
	console.log("  • Proper indexes for performance")
	console.log("  • Authenticated user access only")
	console.log("")
	console.log("🧪 VERIFICATION:")
	console.log("After deployment, test with:")
	console.log("SELECT * FROM get_user_credit_info('your_clerk_user_id');")
	console.log("")
	console.log("🎉 Once deployed, credit tracking will work automatically!")
}

// Always show manual instructions
showManualInstructions()
