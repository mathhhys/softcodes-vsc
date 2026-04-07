/**
 * Test the complete auth flow to verify webview updates
 */

import { UnifiedAuthService } from "./unifiedAuthService"
import { verifyJWTUserInSupabase } from "./supabaseUserVerification"

export async function testCompleteAuthFlow(context: any, kilocodeToken: string): Promise<void> {
	console.log("\n🔄 TESTING COMPLETE AUTH FLOW")
	console.log("=".repeat(50))

	try {
		// Step 1: Test UnifiedAuthService
		console.log("1️⃣ Testing UnifiedAuthService...")
		const authService = UnifiedAuthService.getInstance(context)

		// Step 2: Get current auth state (this should trigger Supabase verification)
		console.log("2️⃣ Getting authentication state (will trigger Supabase verification)...")
		const authState = await authService.getAuthenticationState()

		console.log("📊 Auth State Result:", {
			isAuthenticated: authState.isAuthenticated,
			isConnected: authState.isConnected,
			supabaseVerified: authState.supabaseVerified,
			hasSupabaseData: !!authState.supabaseUserData,
			error: authState.error,
		})

		// Step 3: Test direct Supabase verification
		console.log("3️⃣ Testing direct Supabase verification...")
		const supabaseResult = await verifyJWTUserInSupabase(kilocodeToken)

		console.log("📊 Direct Supabase Result:", {
			success: supabaseResult.success,
			userExists: supabaseResult.userExistsInSupabase,
			userDetails: supabaseResult.userDetails ? "Present" : "Missing",
			error: supabaseResult.error,
		})

		// Step 4: Check if user info can be retrieved
		console.log("4️⃣ Testing extended user info...")
		if (authState.isConnected) {
			const extendedInfo = await authService.getExtendedUserInfo()
			console.log("📊 Extended User Info:", {
				hasExtendedInfo: !!extendedInfo,
				email: extendedInfo?.email,
				planType: extendedInfo?.planType,
				credits: extendedInfo?.credits,
			})
		}

		console.log("\n✅ Auth flow test completed!")
		console.log("Expected webview messages should be sent with:")
		console.log("  - authStateChanged")
		console.log("  - connectionStatusChanged")
		console.log("  - isConnected:", authState.isConnected)
		console.log("  - supabaseUserData:", !!authState.supabaseUserData)
	} catch (error) {
		console.error("❌ Auth flow test failed:", error)
	}
}

export async function testAuthStateMessage(): Promise<void> {
	console.log("\n📨 TESTING AUTH STATE MESSAGE FORMAT")
	console.log("=".repeat(50))

	// This is what should be sent to the webview
	const expectedMessage = {
		type: "authStateChanged",
		isAuthenticated: true,
		isConnected: true,
		softcodesUserInfo: {
			email: "mathys@softcodes.io",
			clerkId: "user_31vdw7c9BAYCHGHIggfTbJuURIS",
			firstName: null,
			lastName: null,
			planType: "starter",
			credits: 25,
		},
		authenticationState: {
			isAuthenticated: true,
			isConnected: true,
			clerkId: "user_31vdw7c9BAYCHGHIggfTbJuURIS",
			supabaseVerified: true,
			supabaseUserData: {
				id: "197a35d6-e2a6-4cfe-8aca-97a6a5a87223",
				clerk_id: "user_31vdw7c9BAYCHGHIggfTbJuURIS",
				email: "mathys@softcodes.io",
				plan_type: "starter",
				credits: 25,
			},
		},
		supabaseVerified: true,
	}

	console.log("📨 Expected webview message format:")
	console.log(JSON.stringify(expectedMessage, null, 2))

	console.log("\n✅ This should trigger ProfileView state updates:")
	console.log("  - setAuthState(message.authenticationState)")
	console.log("  - setIsConnected(message.isConnected)")
	console.log("  - Update profile data with Supabase info")
}
