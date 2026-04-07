# Credit Management System Guide

This guide explains how to implement and use the real-time credit management system in your VSCode extension.

## Overview

The credit management system provides:

- ✅ **Minimal Latency**: Sub-100ms credit deductions with intelligent caching
- ✅ **Real-time Updates**: Live credit balance updates using Supabase Realtime
- ✅ **JWT Integration**: Seamless integration with your existing Clerk JWT system
- ✅ **Atomic Operations**: Database-level atomic credit deductions
- ✅ **Complete Audit Trail**: Full transaction logging
- ✅ **Error Handling**: Comprehensive error handling and rollback mechanisms
- ✅ **Credit Validation**: Pre-operation credit checks to prevent overdrafts

## Quick Start

### 1. Database Setup

First, apply the database schema to your Supabase database:

```sql
-- Run the contents of src/database/supabase-credit-schema.sql
-- This adds credit tracking columns and atomic functions
```

### 2. Basic Integration

```typescript
import { deductCreditsFromJWT, checkUserCredits, subscribeToUserCredits } from "./services/creditManager"

// Example: Deduct credits for an API operation
async function performAPIOperation(jwtToken: string, operationCost: number) {
	// Check credits before operation
	const hasCredits = await validateSufficientCredits(jwtToken, operationCost)
	if (!hasCredits) {
		throw new Error("Insufficient credits")
	}

	// Perform your API operation
	const result = await yourAPICall()

	// Deduct credits after successful operation
	const deduction = await deductCreditsFromJWT(jwtToken, operationCost, "API operation description")

	if (!deduction.success) {
		console.error("Credit deduction failed:", deduction.error)
	}

	return result
}
```

### 3. Real-time Updates

```typescript
import { subscribeToUserCredits } from "./services/realtimeCreditUpdates"

// Subscribe to real-time credit updates
const subscriptionId = await subscribeToUserCredits(userClerkId, (update) => {
	console.log(`Credits updated: ${update.newBalance}`)
	// Update your UI here
	updateCreditDisplay(update.newBalance)
})
```

## API Reference

### Core Functions

#### `deductCreditsFromJWT(token, usdAmount, description?, metadata?)`

Deducts credits from a user based on their JWT token.

**Parameters:**

- `token: string` - JWT token from your authentication system
- `usdAmount: number` - USD amount to charge (automatically converted to credits)
- `description?: string` - Optional description for the transaction
- `metadata?: object` - Optional metadata to store with the transaction

**Returns:** `Promise<CreditTransaction>`

```typescript
const result = await deductCreditsFromJWT(
	userJWT,
	0.07, // $0.07 = 5 credits
	"Code generation request",
	{ operation: "generate_code", fileType: "typescript" },
)

if (result.success) {
	console.log(`Deducted ${result.creditsDeducted} credits`)
	console.log(`Remaining balance: ${result.balanceAfter}`)
} else {
	console.error(`Failed: ${result.error}`)
}
```

#### `checkUserCredits(token)`

Gets the current credit balance for a user.

**Parameters:**

- `token: string` - JWT token

**Returns:** `Promise<UserCreditInfo | null>`

```typescript
const userInfo = await checkUserCredits(userJWT)
if (userInfo) {
	console.log(`Current balance: ${userInfo.currentCredits} credits`)
	console.log(`Total spent: $${userInfo.totalSpent}`)
}
```

#### `validateSufficientCredits(token, usdAmount)`

Checks if a user has sufficient credits for an operation without deducting.

**Parameters:**

- `token: string` - JWT token
- `usdAmount: number` - USD amount to check

**Returns:** `Promise<boolean>`

```typescript
const canAfford = await validateSufficientCredits(userJWT, 0.07)
if (!canAfford) {
	showInsufficientCreditsDialog()
	return
}
```

### Real-time Functions

#### `subscribeToUserCredits(clerkUserId, callback)`

Subscribe to real-time credit updates for a user.

**Parameters:**

- `clerkUserId: string` - User's Clerk ID
- `callback: (update: CreditUpdateEvent) => void` - Update callback

**Returns:** `Promise<string | null>` - Subscription ID

```typescript
const subscriptionId = await subscribeToUserCredits("user_123", (update) => {
	console.log("Credit update:", {
		operation: update.operation,
		creditsChanged: update.creditsChanged,
		newBalance: update.newBalance,
	})
})
```

#### `onLowCreditWarning(callback)`

Listen for low credit warnings.

```typescript
onLowCreditWarning((warning) => {
	showNotification(`Low credits: ${warning.currentBalance} remaining`, "Buy Credits")
})
```

### Credit Conversion

#### `usdToCredits(usdAmount)` / `creditsToUSD(credits)`

Convert between USD and credits.

```typescript
const credits = usdToCredits(0.07) // 5 credits
const usd = creditsToUSD(10) // $0.14
```

## Integration Patterns

### Pattern 1: VSCode Command with Credit Check

```typescript
vscode.commands.registerCommand("extension.generateCode", async () => {
	const token = await authService.getAccessToken()
	if (!token) return

	// Pre-check credits
	const canAfford = await validateSufficientCredits(token, API_COSTS.CODE_GENERATION)
	if (!canAfford) {
		vscode.window.showWarningMessage("Insufficient credits for code generation", "Buy Credits")
		return
	}

	// Show progress
	vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Generating code...",
		},
		async () => {
			try {
				// Perform operation
				const code = await generateCode(prompt)

				// Deduct credits
				await deductCreditsFromJWT(
					token,
					API_COSTS.CODE_GENERATION,
					`Code generation: ${prompt.substring(0, 50)}...`,
				)

				// Insert code
				insertCodeAtCursor(code)
			} catch (error) {
				vscode.window.showErrorMessage(`Generation failed: ${error.message}`)
			}
		},
	)
})
```

### Pattern 2: API Client with Credit Integration

```typescript
class CreditAwareAPIClient {
	async callAPI<T>(
		operation: string,
		cost: number,
		apiCall: () => Promise<T>,
	): Promise<{ data?: T; error?: string; creditsUsed: number }> {
		const token = await this.getToken()

		// Check credits
		const sufficient = await validateSufficientCredits(token, cost)
		if (!sufficient) {
			return { error: "Insufficient credits", creditsUsed: 0 }
		}

		try {
			// Execute API call
			const data = await apiCall()

			// Deduct credits
			const deduction = await deductCreditsFromJWT(token, cost, operation)

			return {
				data,
				creditsUsed: deduction.creditsDeducted || 0,
			}
		} catch (error) {
			return { error: error.message, creditsUsed: 0 }
		}
	}
}
```

### Pattern 3: Real-time UI Updates

```typescript
class CreditDisplay {
	private currentBalance = 0

	async initialize(clerkUserId: string) {
		// Get initial balance
		const userInfo = await checkUserCredits(await this.getToken())
		if (userInfo) {
			this.updateDisplay(userInfo.currentCredits)
		}

		// Subscribe to updates
		await subscribeToUserCredits(clerkUserId, (update) => {
			this.updateDisplay(update.newBalance)

			if (update.operation === "deduction") {
				this.showUsageNotification(update.creditsChanged, update.newBalance)
			}
		})

		// Listen for low credit warnings
		onLowCreditWarning((warning) => {
			this.showLowCreditWarning(warning.currentBalance)
		})
	}

	private updateDisplay(credits: number) {
		this.currentBalance = credits
		const usdValue = creditsToUSD(credits)
		vscode.commands.executeCommand("setContext", "softcodes.creditBalance", credits)
		vscode.commands.executeCommand("setContext", "softcodes.creditValue", `$${usdValue.toFixed(3)}`)
	}
}
```

## Cost Configuration

Define your operation costs in a central location:

```typescript
export const API_COSTS = {
	SIMPLE_QUERY: 0.014, // 1 credit
	CODE_GENERATION: 0.07, // 5 credits
	CODE_ANALYSIS: 0.042, // 3 credits
	FILE_PROCESSING: 0.028, // 2 credits
	CHAT_MESSAGE: 0.014, // 1 credit
	TRANSLATION: 0.021, // 1.5 credits
} as const
```

## Error Handling

The system provides comprehensive error handling:

```typescript
const result = await deductCreditsFromJWT(token, cost, description)

switch (result.error) {
	case "invalid_jwt":
		// Redirect to login
		break
	case "insufficient_credits":
		// Show purchase dialog
		break
	case "user_not_found":
		// Handle account issues
		break
	case "system_error":
		// Retry or show error
		break
}
```

## Performance Optimization

### Caching Strategy

The system uses intelligent caching:

- **JWT Cache**: 10 seconds (avoids repeated JWT verification)
- **User Cache**: 30 seconds (balances freshness with performance)
- **Automatic Cache Invalidation**: On real-time updates

### Best Practices

1. **Pre-check Credits**: Always validate before expensive operations
2. **Batch Operations**: Group multiple small operations when possible
3. **Cache Management**: Clear cache after credit purchases
4. **Error Recovery**: Implement retry logic for network errors

```typescript
// Good: Pre-check before expensive operation
const canAfford = await validateSufficientCredits(token, operationCost)
if (!canAfford) {
	return showInsufficientCreditsDialog()
}

// Good: Clear cache after purchase
await creditManager.clearUserCache(userClerkId)

// Good: Retry on network errors
async function robustCreditDeduction(token: string, cost: number, retries = 3) {
	for (let i = 0; i < retries; i++) {
		try {
			return await deductCreditsFromJWT(token, cost)
		} catch (error) {
			if (i === retries - 1) throw error
			await delay(1000 * Math.pow(2, i)) // Exponential backoff
		}
	}
}
```

## Database Schema

The system adds these components to your existing `users` table:

```sql
-- Additional columns
ALTER TABLE users ADD COLUMN credits_used integer DEFAULT 0;
ALTER TABLE users ADD COLUMN total_spent_usd decimal(10,4) DEFAULT 0.00;
ALTER TABLE users ADD COLUMN last_credit_update timestamp DEFAULT now();

-- Transaction audit table
CREATE TABLE credit_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES users(id),
  operation_type text CHECK (operation_type IN ('deduction', 'addition', 'purchase', 'refund')),
  credits_amount integer NOT NULL,
  usd_amount decimal(10,4) NOT NULL,
  balance_before integer NOT NULL,
  balance_after integer NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}',
  created_at timestamp DEFAULT now()
);

-- Atomic functions
CREATE FUNCTION deduct_user_credits(...) -- See schema file
CREATE FUNCTION add_user_credits(...)    -- See schema file
CREATE FUNCTION get_user_credit_info(...) -- See schema file
```

## Monitoring

Track system health with built-in monitoring:

```typescript
// Get cache statistics
const stats = creditManager.getCacheStats()
console.log("Cache performance:", {
	userCacheSize: stats.userCacheSize,
	jwtCacheSize: stats.jwtCacheSize,
	hitRate: calculateHitRate(),
})

// Monitor real-time connection status
realtimeCreditService.on("connected", () => {
	console.log("Real-time updates connected")
})

realtimeCreditService.on("disconnected", () => {
	console.log("Real-time updates disconnected")
})
```

## Testing

Run the comprehensive test suite:

```bash
# Test credit manager
cd src && npx vitest tests/creditManager.test.ts

# Test real-time updates
cd src && npx vitest tests/realtimeCreditUpdates.test.ts

# Run all credit system tests
cd src && npx vitest tests/credit*.test.ts
```

## Security Considerations

1. **JWT Validation**: All operations validate JWT tokens
2. **Rate Limiting**: Implement rate limiting on credit operations
3. **Audit Trail**: Complete transaction logging for compliance
4. **Cache Security**: Sensitive data is not cached long-term
5. **Database Security**: Row-level security on transaction tables

## Troubleshooting

### Common Issues

**Credits not deducting:**

- Check JWT token validity
- Verify user exists in database
- Check Supabase configuration

**Real-time updates not working:**

- Verify Supabase Realtime is enabled
- Check network connectivity
- Review browser console for connection errors

**Performance issues:**

- Monitor cache hit rates
- Check database query performance
- Verify network latency

### Debug Mode

Enable debug logging:

```typescript
// Enable detailed logging
process.env.CREDIT_DEBUG = "true"
```

This comprehensive credit management system provides everything you need for real-time, low-latency credit tracking in your VSCode extension while maintaining data integrity and providing excellent user experience.
