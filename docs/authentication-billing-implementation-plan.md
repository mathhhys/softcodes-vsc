# Authentication and Provider-Specific Billing Implementation Plan

## Overview

This document outlines the detailed implementation plan for requiring user authentication before allowing requests and applying a credit-based system exclusively to `kilocode` and `openrouter` providers, while enforcing dollar-based billing for all other providers.

## 🏗️ Architecture Summary

### Current State Analysis

- ✅ Authentication infrastructure exists via [`UnifiedAuthService`](../src/auth/unifiedAuthService.ts)
- ✅ Credit management exists via [`CreditManagerService`](../src/services/creditManager.ts)
- ✅ Post-payment billing implemented for `openrouter` and `kilocode` in [`Task.ts`](../src/core/task/Task.ts#L1410-1476)
- ❌ No authentication gates before API requests
- ❌ No pre-flight credit checks
- ❌ No clear billing model separation in UI

### Target State

- 🎯 All API requests require authentication
- 🎯 Credit-based billing for `kilocode` and `openrouter` providers only
- 🎯 Dollar-based billing for all other providers
- 🎯 Clear user experience with appropriate error messaging

## 📁 File Structure Changes

### New Files to Create

```
src/core/billing/
├── BillingStrategy.ts              # Billing strategy interface and implementations
├── AuthenticationGate.ts           # Authentication gate service
├── BillingError.ts                 # Billing-specific error types
└── __tests__/
    ├── BillingStrategy.test.ts
    ├── AuthenticationGate.test.ts
    └── BillingError.test.ts

src/services/billing/
├── PreflightCreditChecker.ts       # Pre-flight credit validation
└── __tests__/
    └── PreflightCreditChecker.test.ts

webview-ui/src/components/billing/
├── BillingModelBadge.tsx           # UI component for billing model indicators
├── CreditBalanceDisplay.tsx        # Credit balance component
└── AuthenticationRequired.tsx      # Authentication prompt component
```

### Files to Modify

```
src/core/task/Task.ts               # Add authentication gate to API requests
src/api/index.ts                    # Integrate billing strategy
packages/types/src/provider-settings.ts # Add billing model types
webview-ui/src/components/settings/providers/ # Add billing indicators
src/shared/WebviewMessage.ts        # Add billing-related message types
```

## 🔧 Technical Implementation

### 1. Billing Strategy Pattern

**Interface Definition** (`src/core/billing/BillingStrategy.ts`):

```typescript
export enum BillingModel {
	CREDIT_BASED = "credit",
	DOLLAR_BASED = "dollar",
}

export interface BillingValidationResult {
	canProceed: boolean
	error?: BillingError
	estimatedCost?: number
	availableCredits?: number
}

export interface BillingStrategy {
	readonly model: BillingModel
	validatePreFlight(
		apiConfiguration: ProviderSettings,
		context: vscode.ExtensionContext,
		estimatedTokens?: number,
	): Promise<BillingValidationResult>
	getProviderRequirements(): string[]
	getUserGuidanceMessage(): string
}

export class CreditBasedBillingStrategy implements BillingStrategy {
	readonly model = BillingModel.CREDIT_BASED

	async validatePreFlight(
		apiConfiguration: ProviderSettings,
		context: vscode.ExtensionContext,
		estimatedTokens: number = 1000,
	): Promise<BillingValidationResult> {
		// Implementation details...
	}

	getProviderRequirements(): string[] {
		return ["Softcodes Authentication", "Sufficient Credit Balance"]
	}

	getUserGuidanceMessage(): string {
		return "This provider uses your Softcodes credit balance. Ensure you are authenticated and have sufficient credits."
	}
}

export class DollarBasedBillingStrategy implements BillingStrategy {
	readonly model = BillingModel.DOLLAR_BASED

	async validatePreFlight(
		apiConfiguration: ProviderSettings,
		context: vscode.ExtensionContext,
	): Promise<BillingValidationResult> {
		// Implementation details...
	}

	getProviderRequirements(): string[] {
		return ["Provider API Key"]
	}

	getUserGuidanceMessage(): string {
		return "This provider requires a valid API key and will bill you directly through their service."
	}
}
```

### 2. Authentication Gate Service

**Implementation** (`src/core/billing/AuthenticationGate.ts`):

```typescript
export class AuthenticationGate {
	private static instance: AuthenticationGate
	private authService: UnifiedAuthService
	private billingStrategies: Map<ProviderName, BillingStrategy>

	constructor(context: vscode.ExtensionContext) {
		this.authService = UnifiedAuthService.getInstance(context)
		this.billingStrategies = this.initializeBillingStrategies()
	}

	private initializeBillingStrategies(): Map<ProviderName, BillingStrategy> {
		const strategies = new Map<ProviderName, BillingStrategy>()

		// Credit-based providers
		strategies.set("kilocode", new CreditBasedBillingStrategy())
		strategies.set("openrouter", new CreditBasedBillingStrategy())

		// Dollar-based providers
		strategies.set("anthropic", new DollarBasedBillingStrategy())
		strategies.set("openai", new DollarBasedBillingStrategy())
		strategies.set("bedrock", new DollarBasedBillingStrategy())
		// ... other providers

		return strategies
	}

	async validateRequest(
		apiConfiguration: ProviderSettings,
		context: vscode.ExtensionContext,
		estimatedTokens?: number,
	): Promise<BillingValidationResult> {
		// 1. Check authentication for all requests
		const authState = await this.authService.getAuthenticationState()

		if (!authState.isAuthenticated) {
			return {
				canProceed: false,
				error: new AuthenticationRequiredError("User authentication required for all API requests"),
			}
		}

		// 2. Get billing strategy for provider
		const strategy = this.billingStrategies.get(apiConfiguration.apiProvider!)
		if (!strategy) {
			return {
				canProceed: false,
				error: new UnsupportedProviderError(
					`No billing strategy found for provider: ${apiConfiguration.apiProvider}`,
				),
			}
		}

		// 3. Validate provider-specific requirements
		return await strategy.validatePreFlight(apiConfiguration, context, estimatedTokens)
	}
}
```

### 3. Integration with Task.ts

**Modification to** [`src/core/task/Task.ts`](../src/core/task/Task.ts):

```typescript
// Add to imports
import { AuthenticationGate } from '../billing/AuthenticationGate'
import { BillingError, AuthenticationRequiredError, InsufficientCreditsError } from '../billing/BillingError'

// Add to Task class
private authGate: AuthenticationGate

// Modify constructor
constructor(options: TaskOptions) {
  // ... existing code ...
  this.authGate = new AuthenticationGate(this.context)
}

// Modify attemptApiRequest method (around line 1837)
public async *attemptApiRequest(retryAttempt: number = 0): ApiStream {
  // Add authentication gate before existing logic
  const billingValidation = await this.authGate.validateRequest(
    this.apiConfiguration,
    this.context,
    this.estimateTokenUsage() // New method to estimate tokens
  )

  if (!billingValidation.canProceed) {
    yield this.handleBillingError(billingValidation.error!)
    return
  }

  // Continue with existing logic...
}

private async handleBillingError(error: BillingError): Promise<void> {
  switch (error.type) {
    case 'authentication_required':
      await this.ask('authentication_required', error.message)
      break
    case 'insufficient_credits':
      await this.ask('insufficient_credits', error.message)
      break
    case 'api_key_required':
      await this.ask('api_key_required', error.message)
      break
    default:
      await this.ask('billing_error', error.message)
  }
}
```

### 4. Provider Configuration Updates

**Modification to** [`packages/types/src/provider-settings.ts`](../packages/types/src/provider-settings.ts):

```typescript
// Add billing model information
export const providerBillingModel: Record<ProviderName, BillingModel> = {
	kilocode: BillingModel.CREDIT_BASED,
	openrouter: BillingModel.CREDIT_BASED,
	anthropic: BillingModel.DOLLAR_BASED,
	openai: BillingModel.DOLLAR_BASED,
	bedrock: BillingModel.DOLLAR_BASED,
	vertex: BillingModel.DOLLAR_BASED,
	ollama: BillingModel.DOLLAR_BASED,
	"vscode-lm": BillingModel.DOLLAR_BASED,
	lmstudio: BillingModel.DOLLAR_BASED,
	gemini: BillingModel.DOLLAR_BASED,
	"gemini-cli": BillingModel.DOLLAR_BASED,
	"openai-native": BillingModel.DOLLAR_BASED,
	mistral: BillingModel.DOLLAR_BASED,
	deepseek: BillingModel.DOLLAR_BASED,
	unbound: BillingModel.DOLLAR_BASED,
	requesty: BillingModel.DOLLAR_BASED,
	"human-relay": BillingModel.DOLLAR_BASED,
	"fake-ai": BillingModel.DOLLAR_BASED,
	xai: BillingModel.DOLLAR_BASED,
	groq: BillingModel.DOLLAR_BASED,
	chutes: BillingModel.DOLLAR_BASED,
	litellm: BillingModel.DOLLAR_BASED,
	fireworks: BillingModel.DOLLAR_BASED,
	cerebras: BillingModel.DOLLAR_BASED,
	"claude-code": BillingModel.DOLLAR_BASED,
	glama: BillingModel.DOLLAR_BASED,
}

export function getProviderBillingModel(provider: ProviderName): BillingModel {
	return providerBillingModel[provider] || BillingModel.DOLLAR_BASED
}

export function isCreditBasedProvider(provider: ProviderName): boolean {
	return getProviderBillingModel(provider) === BillingModel.CREDIT_BASED
}
```

### 5. UI Components

**New Component** (`webview-ui/src/components/billing/BillingModelBadge.tsx`):

```tsx
interface BillingModelBadgeProps {
	provider: ProviderName
	className?: string
}

export function BillingModelBadge({ provider, className }: BillingModelBadgeProps) {
	const billingModel = getProviderBillingModel(provider)
	const isCreditBased = billingModel === BillingModel.CREDIT_BASED

	return (
		<div className={`billing-badge ${isCreditBased ? "credit-based" : "dollar-based"} ${className}`}>
			{isCreditBased ? (
				<>
					<CreditIcon className="w-3 h-3" />
					<span>Credits</span>
				</>
			) : (
				<>
					<DollarIcon className="w-3 h-3" />
					<span>API Key</span>
				</>
			)}
		</div>
	)
}
```

## 🚨 Error Handling Strategy

### Error Types

```typescript
export abstract class BillingError extends Error {
	abstract readonly type: string
	abstract readonly userAction: string
	abstract readonly actionUrl?: string
}

export class AuthenticationRequiredError extends BillingError {
	readonly type = "authentication_required"
	readonly userAction = "Please sign in to Softcodes to continue"
	readonly actionUrl = undefined // Triggers in-app auth flow
}

export class InsufficientCreditsError extends BillingError {
	readonly type = "insufficient_credits"
	readonly userAction = "Purchase more credits to continue"
	readonly actionUrl = "https://softcodes.ai/credits"

	constructor(
		message: string,
		public readonly availableCredits: number,
		public readonly requiredCredits: number,
	) {
		super(message)
	}
}

export class ApiKeyRequiredError extends BillingError {
	readonly type = "api_key_required"
	readonly userAction = "Configure API key for this provider"
	readonly actionUrl = undefined // Triggers provider settings

	constructor(
		message: string,
		public readonly provider: ProviderName,
	) {
		super(message)
	}
}
```

### User-Facing Error Messages

```typescript
export const ERROR_MESSAGES = {
	AUTHENTICATION_REQUIRED: {
		title: "Authentication Required",
		message: "You must be signed in to Softcodes to use AI features.",
		actions: ["Sign In", "Learn More"],
	},
	INSUFFICIENT_CREDITS: {
		title: "Insufficient Credits",
		message: "You don't have enough credits for this request. This provider uses Softcodes credits.",
		actions: ["Buy Credits", "Check Balance", "Switch Provider"],
	},
	API_KEY_REQUIRED: {
		title: "API Key Required",
		message: "This provider requires a valid API key and bills you directly.",
		actions: ["Configure API Key", "Learn More", "Switch Provider"],
	},
}
```

## 🧪 Testing Strategy

### Unit Tests

1. **BillingStrategy Tests**

    - Credit-based strategy validation
    - Dollar-based strategy validation
    - Error conditions for each strategy

2. **AuthenticationGate Tests**

    - Authentication checks
    - Provider routing
    - Error handling

3. **Integration Tests**
    - End-to-end request flow
    - Error propagation
    - UI component rendering

### Test Cases

```typescript
describe("AuthenticationGate", () => {
	describe("Credit-based providers", () => {
		it("should require authentication for kilocode provider")
		it("should check credit balance before request")
		it("should prevent request with insufficient credits")
		it("should allow request with sufficient credits")
	})

	describe("Dollar-based providers", () => {
		it("should require authentication for anthropic provider")
		it("should check API key configuration")
		it("should prevent request without API key")
		it("should allow request with valid API key")
	})

	describe("Error handling", () => {
		it("should show appropriate error for unauthenticated user")
		it("should show credit purchase flow for insufficient credits")
		it("should show API key setup for missing keys")
	})
})
```

## 🚀 Migration Strategy

### Phase 1: Core Infrastructure (Week 1)

- [ ] Implement billing strategy interfaces
- [ ] Create authentication gate service
- [ ] Add billing error types
- [ ] Update provider configurations

### Phase 2: Integration (Week 2)

- [ ] Integrate authentication gate with Task.ts
- [ ] Implement pre-flight credit checks
- [ ] Add billing-specific error handling
- [ ] Update API request flow

### Phase 3: User Experience (Week 3)

- [ ] Create billing model UI components
- [ ] Add provider setup guidance
- [ ] Implement error dialogs and flows
- [ ] Update provider selection interface

### Phase 4: Testing & Polish (Week 4)

- [ ] Comprehensive testing suite
- [ ] Performance optimization
- [ ] Documentation updates
- [ ] User acceptance testing

## 🔄 Backwards Compatibility

- Existing users with configured API keys will continue to work
- Current credit system for kilocode/openrouter remains unchanged
- New authentication requirement is additive, not breaking
- Clear migration path for users to authenticate

## 📊 Success Metrics

1. **Authentication Coverage**: 100% of API requests require authentication
2. **Billing Clarity**: Clear separation between credit and dollar billing
3. **Error Reduction**: Fewer billing-related support requests
4. **User Experience**: Smooth provider setup and switching flows
5. **System Reliability**: Robust error handling for all scenarios

## 🔗 Related Documentation

- [Unified Auth API Specs](./unified-auth-api-specs.md)
- [JWT Verification Implementation](./jwt-verification-implementation-plan.md)
- [Softcodes Auth Integration Plan](./softcodes-auth-integration-plan.md)

---

This implementation plan provides a comprehensive roadmap for implementing authentication gates and provider-specific billing models while maintaining system stability and user experience quality.
