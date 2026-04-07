/**
 * Credit System Diagnostic Logger
 *
 * Adds detailed logging to validate assumptions about the usd_amount_old constraint violation
 */

import { getSupabaseServiceClient } from "./supabaseConfig"

export interface DatabaseDiagnosticResult {
	schemaAnalysis: {
		tableExists: boolean
		columns: Array<{
			name: string
			type: string
			nullable: boolean
			hasDefault: boolean
			defaultValue: string | null
		}>
		hasUsdAmount: boolean
		hasUsdAmountOld: boolean
		missingColumns: string[]
	}
	functionAnalysis: {
		deductFunctionExists: boolean
		functionDefinition?: string
		functionParameters?: string[]
		insertStatement?: string
	}
	lastTransactions: Array<{
		id: string
		created_at: string
		columns: Record<string, any>
	}>
	errors: string[]
}

/**
 * Comprehensive database schema diagnosis
 */
export async function diagnoseDatabaseSchema(): Promise<DatabaseDiagnosticResult> {
	console.log("[CREDIT-DIAGNOSTIC] Starting comprehensive database schema diagnosis...")

	const result: DatabaseDiagnosticResult = {
		schemaAnalysis: {
			tableExists: false,
			columns: [],
			hasUsdAmount: false,
			hasUsdAmountOld: false,
			missingColumns: [],
		},
		functionAnalysis: {
			deductFunctionExists: false,
		},
		lastTransactions: [],
		errors: [],
	}

	try {
		const supabase = await getSupabaseServiceClient()

		// 1. Analyze credit_transactions table structure
		console.log("[CREDIT-DIAGNOSTIC] Step 1: Analyzing credit_transactions table structure...")

		const { data: columns, error: columnsError } = await supabase
			.from("information_schema.columns")
			.select("column_name, data_type, is_nullable, column_default")
			.eq("table_name", "credit_transactions")
			.eq("table_schema", "public")
			.order("ordinal_position")

		if (columnsError) {
			result.errors.push(`Failed to get table columns: ${columnsError.message}`)
		} else if (columns && columns.length > 0) {
			result.schemaAnalysis.tableExists = true
			result.schemaAnalysis.columns = columns.map((col) => ({
				name: col.column_name,
				type: col.data_type,
				nullable: col.is_nullable === "YES",
				hasDefault: col.column_default !== null,
				defaultValue: col.column_default,
			}))

			// Check for specific columns
			result.schemaAnalysis.hasUsdAmount = columns.some((col) => col.column_name === "usd_amount")
			result.schemaAnalysis.hasUsdAmountOld = columns.some((col) => col.column_name === "usd_amount_old")

			// Expected columns from schema
			const expectedColumns = [
				"id",
				"user_id",
				"operation_type",
				"credits_amount",
				"usd_amount",
				"balance_before",
				"balance_after",
				"description",
				"metadata",
				"created_at",
			]

			const actualColumns = columns.map((col) => col.column_name)
			result.schemaAnalysis.missingColumns = expectedColumns.filter(
				(expected) => !actualColumns.includes(expected),
			)

			console.log("[CREDIT-DIAGNOSTIC] Table structure analysis:", {
				tableExists: result.schemaAnalysis.tableExists,
				columnCount: columns.length,
				hasUsdAmount: result.schemaAnalysis.hasUsdAmount,
				hasUsdAmountOld: result.schemaAnalysis.hasUsdAmountOld,
				missingColumns: result.schemaAnalysis.missingColumns,
				actualColumns: actualColumns,
			})
		}

		// 2. Analyze deduct_user_credits function
		console.log("[CREDIT-DIAGNOSTIC] Step 2: Analyzing deduct_user_credits function...")

		const { data: functionInfo, error: functionError } = await supabase
			.from("information_schema.routines")
			.select("routine_name, routine_definition")
			.eq("routine_name", "deduct_user_credits")
			.eq("routine_schema", "public")
			.single()

		if (functionError) {
			result.errors.push(`Failed to get function info: ${functionError.message}`)
		} else if (functionInfo) {
			result.functionAnalysis.deductFunctionExists = true
			result.functionAnalysis.functionDefinition = functionInfo.routine_definition

			// Extract INSERT statement from function definition
			const insertMatch = functionInfo.routine_definition?.match(/INSERT INTO[^;]+;/i)
			if (insertMatch) {
				result.functionAnalysis.insertStatement = insertMatch[0]
			}

			console.log("[CREDIT-DIAGNOSTIC] Function analysis:", {
				functionExists: result.functionAnalysis.deductFunctionExists,
				hasInsertStatement: !!result.functionAnalysis.insertStatement,
			})
		}

		// 3. Get recent transaction attempts (if any exist)
		console.log("[CREDIT-DIAGNOSTIC] Step 3: Checking recent transactions...")

		try {
			const { data: recentTransactions, error: transactionsError } = await supabase
				.from("credit_transactions")
				.select("*")
				.order("created_at", { ascending: false })
				.limit(5)

			if (transactionsError) {
				result.errors.push(`Failed to get recent transactions: ${transactionsError.message}`)
			} else if (recentTransactions) {
				result.lastTransactions = recentTransactions.map((tx) => ({
					id: tx.id,
					created_at: tx.created_at,
					columns: tx,
				}))

				console.log("[CREDIT-DIAGNOSTIC] Recent transactions found:", recentTransactions.length)
			}
		} catch (txError) {
			result.errors.push(
				`Transaction query failed: ${txError instanceof Error ? txError.message : String(txError)}`,
			)
		}

		// 4. Test function call with logging
		console.log("[CREDIT-DIAGNOSTIC] Step 4: Testing function call...")

		try {
			const { data: testResult, error: testError } = await supabase.rpc("deduct_user_credits", {
				p_user_id: "00000000-0000-0000-0000-000000000000", // Invalid UUID for test
				p_credits_to_deduct: 1,
				p_usd_amount: 0.014,
				p_description: "Diagnostic test call",
				p_metadata: { diagnostic: true, timestamp: new Date().toISOString() },
			})

			if (testError) {
				console.log("[CREDIT-DIAGNOSTIC] Function test error (expected):", testError.message)

				// Check if the error mentions usd_amount_old specifically
				if (testError.message.includes("usd_amount_old")) {
					result.errors.push(
						`CONFIRMED: usd_amount_old constraint violation in function: ${testError.message}`,
					)
				} else {
					result.errors.push(`Function test error: ${testError.message}`)
				}
			} else {
				console.log("[CREDIT-DIAGNOSTIC] Function test result:", testResult)
			}
		} catch (funcError) {
			result.errors.push(
				`Function call test failed: ${funcError instanceof Error ? funcError.message : String(funcError)}`,
			)
		}

		console.log("[CREDIT-DIAGNOSTIC] ✅ Database schema diagnosis completed")
		return result
	} catch (error) {
		console.error("[CREDIT-DIAGNOSTIC] Diagnostic failed:", error)
		result.errors.push(`Diagnostic process failed: ${error instanceof Error ? error.message : String(error)}`)
		return result
	}
}

/**
 * Log detailed credit deduction attempt for debugging
 */
export async function logCreditDeductionAttempt(
	userId: string,
	creditsToDeduct: number,
	usdAmount: number,
	description?: string,
	metadata?: any,
): Promise<void> {
	const diagnosticPayload = (() => {
		try {
			return {
				userId,
				creditsToDeduct,
				usdAmount,
				description,
				metadata: metadata === undefined ? undefined : JSON.parse(JSON.stringify(metadata)),
				timestamp: new Date().toISOString(),
			}
		} catch {
			return {
				userId,
				creditsToDeduct,
				usdAmount,
				description,
				metadata: "[Unserializable metadata]",
				timestamp: new Date().toISOString(),
			}
		}
	})()

	console.log("[CREDIT-DEDUCTION-LOG] Attempting credit deduction with parameters:", diagnosticPayload)

	try {
		const supabase = await getSupabaseServiceClient()

		const { data, error } = await supabase
			.from("credit_transactions")
			.select("id, created_at, credits_amount, usd_amount, balance_after")
			.eq("user_id", userId)
			.order("created_at", { ascending: false })
			.limit(1)

		if (error) {
			console.error("[CREDIT-DEDUCTION-LOG] Unable to fetch last transaction snapshot:", {
				errorMessage: error.message,
				errorCode: error.code,
				errorDetails: error.details,
				errorHint: error.hint,
			})
		} else if (Array.isArray(data) && data.length > 0) {
			console.log("[CREDIT-DEDUCTION-LOG] Last recorded transaction snapshot:", data[0])
		} else {
			console.log("[CREDIT-DEDUCTION-LOG] No previous transactions found for user")
		}
	} catch (error) {
		console.error("[CREDIT-DEDUCTION-LOG] Diagnostic lookup failed:", error)
	}
}

/**
 * Run comprehensive diagnostic and return formatted report
 */
export async function generateDiagnosticReport(): Promise<string> {
	const diagnosticResult = await diagnoseDatabaseSchema()

	let report = "🔍 CREDIT SYSTEM DIAGNOSTIC REPORT\n"
	report += "=".repeat(50) + "\n\n"

	// Schema Analysis
	report += "📊 DATABASE SCHEMA ANALYSIS:\n"
	report += `-  Table exists: ${diagnosticResult.schemaAnalysis.tableExists}\n`
	report += `-  Total columns: ${diagnosticResult.schemaAnalysis.columns.length}\n`
	report += `-  Has usd_amount: ${diagnosticResult.schemaAnalysis.hasUsdAmount}\n`
	report += `-  Has usd_amount_old: ${diagnosticResult.schemaAnalysis.hasUsdAmountOld}\n`

	if (diagnosticResult.schemaAnalysis.missingColumns.length > 0) {
		report += `-  Missing columns: ${diagnosticResult.schemaAnalysis.missingColumns.join(", ")}\n`
	}

	report += "\n📋 ACTUAL COLUMNS:\n"
	diagnosticResult.schemaAnalysis.columns.forEach((col) => {
		report += `-  ${col.name} (${col.type}) - nullable: ${col.nullable}\n`
	})

	// Function Analysis
	report += "\n🔧 FUNCTION ANALYSIS:\n"
	report += `-  deduct_user_credits exists: ${diagnosticResult.functionAnalysis.deductFunctionExists}\n`

	if (diagnosticResult.functionAnalysis.insertStatement) {
		report += `-  INSERT statement: ${diagnosticResult.functionAnalysis.insertStatement}\n`
	}

	// Recent Transactions
	report += "\n📝 RECENT TRANSACTIONS:\n"
	report += `-  Found ${diagnosticResult.lastTransactions.length} recent transactions\n`

	// Errors
	if (diagnosticResult.errors.length > 0) {
		report += "\n❌ ERRORS FOUND:\n"
		diagnosticResult.errors.forEach((error) => {
			report += `-  ${error}\n`
		})
	}

	// Recommendations
	report += "\n💡 RECOMMENDATIONS:\n"
	if (diagnosticResult.schemaAnalysis.hasUsdAmountOld && !diagnosticResult.schemaAnalysis.hasUsdAmount) {
		report += `-  🚨 CRITICAL: Database has usd_amount_old but application expects usd_amount\n`
		report += `-  📝 ACTION: Run schema migration to rename usd_amount_old to usd_amount\n`
	}

	if (diagnosticResult.schemaAnalysis.missingColumns.length > 0) {
		report += `-  📝 ACTION: Add missing columns: ${diagnosticResult.schemaAnalysis.missingColumns.join(", ")}\n`
	}

	return report
}
