import { JWT_CONFIG } from "../config"
import { UnifiedAuthService } from "../unifiedAuthService"

// Vitest globals are available per project rules
// Helper: minimal base64url encoder
function b64url(input: string): string {
	return Buffer.from(input, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

// Helper: create a simple unsigned JWT with configurable exp delta (in seconds)
function createJwtWithExpDelta(deltaSeconds: number): string {
	const now = Math.floor(Date.now() / 1000)
	const header = { alg: "none", typ: "JWT" }
	const payload = {
		iss: "https://clerk.softcodes.ai",
		sub: "user_123",
		email: "user@example.com",
		iat: now,
		exp: now + deltaSeconds,
	}
	return `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}.x`
}

// Mock vscode module (minimal surface used by UnifiedAuthService)
vi.mock("vscode", () => {
	const secretsMap = new Map<string, string | undefined>()

	const secrets = {
		get: vi.fn(async (key: string) => secretsMap.get(key)),
		store: vi.fn(async (key: string, value: string) => {
			secretsMap.set(key, value)
		}),
		delete: vi.fn(async (key: string) => {
			secretsMap.delete(key)
		}),
		_map: secretsMap,
	}

	const globalState = {
		update: vi.fn(async (_key: string, _value: unknown) => {}),
		get: vi.fn((key: string) => undefined as any),
	}

	// minimal stubs used in code paths we may hit indirectly
	const workspace = {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue(false), // softcodes.auth.skipAPIValidation default false
		}),
		workspaceFolders: undefined as any,
	}

	const window = {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	}

	const env = {
		openExternal: vi.fn(),
	}

	const commands = {
		executeCommand: vi.fn(),
	}

	// Extension context mock factory for tests to use
	const createMockContext = () => ({
		secrets,
		globalState,
		subscriptions: [],
	})

	return {
		__esModule: true,
		secrets, // exported for debug if needed
		workspace,
		window,
		env,
		commands,
		extensions: {
			getExtension: vi.fn().mockReturnValue({ packageJSON: { version: "test" } }),
		},
		// Provide a helper for tests to create a fresh mock context
		default: { createMockContext },
		createMockContext,
	}
})

describe("UnifiedAuthService - auto refresh and strict expiry", () => {
	// Local helper to build a VSCode-like ExtensionContext mock
	function createTestContext() {
		const secretsMap = new Map<string, string | undefined>()
		const secrets = {
			get: vi.fn(async (key: string) => secretsMap.get(key)),
			store: vi.fn(async (key: string, value: string) => {
				secretsMap.set(key, value)
			}),
			delete: vi.fn(async (key: string) => {
				secretsMap.delete(key)
			}),
			_map: secretsMap,
		}
		const globalState = {
			update: vi.fn(async (_key: string, _value: unknown) => {}),
			get: vi.fn((_key: string) => undefined as any),
		}
		return {
			secrets,
			globalState,
			subscriptions: [] as any[],
		}
	}

	let context: any
	let service: UnifiedAuthService

	beforeEach(async () => {
		// fresh context and clear secrets/global state spies
		context = createTestContext()
		context.secrets._map.clear()
		context.secrets.get.mockClear()
		context.secrets.store.mockClear()
		context.secrets.delete.mockClear()
		context.globalState.update.mockClear()
		context.globalState.get.mockClear()

		// Reset singleton to avoid cross-test state bleed
		;(UnifiedAuthService as any).instance = undefined

		// Create a fresh instance bound to our new context
		service = UnifiedAuthService.getInstance(context as any)

		// Ensure no leftover spies on instance methods
		vi.restoreAllMocks()
	})

	test("Expired token with refresh_token triggers immediate refresh and returns fresh token", async () => {
		// expired token: exp in the past (-60s)
		const expired = createJwtWithExpDelta(-60)
		await context.secrets.store("access_token", expired)
		await context.secrets.store("refresh_token", "r_token")

		// Spy on internal refresh method (private at TS level, but accessible at runtime)
		const refreshSpy = vi
			.spyOn(service as any, "performTokenRefreshWithLocking")
			.mockResolvedValue("fresh_access_token")

		const result = await service.ensureValidAccessToken()

		expect(refreshSpy).toHaveBeenCalledTimes(1)
		expect(result).toBe("fresh_access_token")
	})

	test("Expired token without refresh_token returns undefined (no verification loops)", async () => {
		const expired = createJwtWithExpDelta(-120)
		await context.secrets.store("access_token", expired)
		// no refresh_token stored

		const refreshSpy = vi.spyOn(service as any, "performTokenRefreshWithLocking")

		const result = await service.ensureValidAccessToken()

		expect(refreshSpy).not.toHaveBeenCalled()
		expect(result).toBeUndefined()
	})

	test("getAccessToken returns undefined when token is expired and no refresh_token is stored (strict policy)", async () => {
		const expired = createJwtWithExpDelta(-30)
		await context.secrets.store("access_token", expired)
		// no refresh token
		const token = await service.getAccessToken()
		expect(token).toBeUndefined()
	})

	test("Proactive refresh uses JWT_CONFIG.TOKEN_REFRESH_THRESHOLD (triggers refresh when within threshold)", async () => {
		// Token expires within threshold/2 seconds to ensure proactive branch
		const threshold = JWT_CONFIG.TOKEN_REFRESH_THRESHOLD ?? 300
		const expDelta = Math.max(1, Math.floor(threshold / 2)) // seconds
		const nearExpiry = createJwtWithExpDelta(expDelta)
		await context.secrets.store("access_token", nearExpiry)
		await context.secrets.store("refresh_token", "r_token")

		const refreshSpy = vi
			.spyOn(service as any, "performTokenRefreshWithLocking")
			.mockResolvedValue("proactively_refreshed_token")

		const result = await service.ensureValidAccessToken()

		// Should attempt proactive refresh and return the refreshed token
		expect(refreshSpy).toHaveBeenCalledTimes(1)
		expect(result).toBe("proactively_refreshed_token")
	})
})
