// import { useExtensionState } from "@/context/ExtensionStateContext" // No longer needed
import React, { useEffect } from "react"
import { vscode } from "@/utils/vscode"

import { BalanceDataResponsePayload, ProfileData, ProfileDataResponsePayload } from "@roo/WebviewMessage"
import { ExtensionMessage } from "@roo/ExtensionMessage"
import { VSCodeButtonLink } from "@/components/common/VSCodeButtonLink"
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import CountUp from "react-countup"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Tab, TabContent, TabHeader } from "@src/components/common/Tab"
import { Button } from "@src/components/ui"
import KiloCodeAuth from "../common/KiloCodeAuth"

interface ProfileViewProps {
	onDone: () => void
}

const ProfileView: React.FC<ProfileViewProps> = ({ onDone }) => {
	const { apiConfiguration, currentApiConfigName } = useExtensionState()
	const { t } = useAppTranslation()
	const [profileData, setProfileData] = React.useState<ProfileData | undefined | null>(null)
	const [isLoadingUser, setIsLoadingUser] = React.useState(true)
	const [authState, setAuthState] = React.useState<any>(null)
	const [isConnected, setIsConnected] = React.useState(false)
	const lastRefreshRef = React.useRef<number>(Date.now())
	const [creditBalance, setCreditBalance] = React.useState<number | null>(null)

	// Centralized data fetching function
	const fetchAllData = React.useCallback(() => {
		if (!apiConfiguration?.kilocodeToken) {
			console.log("⏹️ [ProfileView] fetchAllData blocked - no token available")
			return
		}

		console.log("🔄 [ProfileView] Fetching all profile data...")
		console.log("🔄 [ProfileView] Current API config:", apiConfiguration)
		lastRefreshRef.current = Date.now()

		// Fetch profile data
		console.log("📨 [ProfileView] Sending fetchProfileDataRequest...")
		vscode.postMessage({
			type: "fetchProfileDataRequest",
		})

		// Fetch balance data
		console.log("📨 [ProfileView] Sending fetchBalanceDataRequest...")
		vscode.postMessage({
			type: "fetchBalanceDataRequest",
		})

		// Fetch Softcodes balance data (live storage)
		console.log("📨 [ProfileView] Sending fetchSoftcodesBalanceRequest...")
		vscode.postMessage({
			type: "fetchSoftcodesBalanceRequest",
		})

		// CRITICAL: Check auth state to trigger Supabase verification and get connection status
		console.log("📨 [ProfileView] Sending checkSoftcodesAuth message...")
		vscode.postMessage({
			type: "checkSoftcodesAuth",
		})
	}, [apiConfiguration])

	useEffect(() => {
		console.log("🔄 [ProfileView] useEffect triggered by kilocodeToken change:", {
			hasToken: !!apiConfiguration?.kilocodeToken,
			tokenLength: apiConfiguration?.kilocodeToken ? apiConfiguration.kilocodeToken.length : 0,
			currentApiConfigName: currentApiConfigName,
		})
		fetchAllData()
	}, [apiConfiguration?.kilocodeToken, fetchAllData])

	// Periodic refresh to maintain connection (every 30 seconds if token exists)
	useEffect(() => {
		if (!apiConfiguration?.kilocodeToken) {
			console.log("⏹️ [ProfileView] No token, skipping periodic refresh setup")
			return
		}

		console.log("🔄 [ProfileView] Setting up periodic refresh (30s interval)")
		const interval = setInterval(() => {
			const timeSinceLastRefresh = Date.now() - lastRefreshRef.current
			// Refresh every 30 seconds to maintain active connection
			if (timeSinceLastRefresh > 30000) {
				console.log("🔄 [ProfileView] Periodic refresh triggered")
				fetchAllData()
			}
		}, 30000)

		return () => {
			console.log("🧹 [ProfileView] Cleaning up periodic refresh interval")
			clearInterval(interval)
		}
	}, [apiConfiguration?.kilocodeToken, fetchAllData])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data as ExtensionMessage
			console.log("📨 [ProfileView] Received message:", message.type, message)

			if (message.type === "profileDataResponse") {
				console.log("📨 [ProfileView] Received profileDataResponse:", message.payload)
				const payload = message.payload as ProfileDataResponsePayload
				if (payload.success) {
					console.log("✅ [ProfileView] Profile data response successful:", payload.data)
					setProfileData(payload.data)
					console.log("✅ [ProfileView] Profile data set:", payload.data)
					// If we have profile data, we're likely authenticated
					if (payload.data?.user && !isConnected) {
						console.log("🔗 [ProfileView] Profile data available but not connected - checking auth...")
						vscode.postMessage({ type: "checkSoftcodesAuth" })
					}
				} else {
					console.error("❌ [ProfileView] Error fetching profile data:", payload.error)
					console.log("❌ [ProfileView] Setting profile data to null due to error")
					setProfileData(null)
				}
				setIsLoadingUser(false)
			} else if (message.type === "authStateChanged") {
				console.log("🔔 [ProfileView] Received authStateChanged message:", {
					isAuthenticated: message.isAuthenticated,
					isConnected: message.isConnected,
					hasUserInfo: !!message.softcodesUserInfo,
					hasAuthState: !!message.authenticationState,
					supabaseVerified: message.supabaseVerified,
				})

				// Update authentication state and connection status with priority to auth state
				const newAuthState = message.authenticationState
				const newConnectionStatus = message.isConnected || false

				setAuthState(newAuthState)
				setIsConnected(newConnectionStatus)

				console.log("🔄 [ProfileView] Updated auth state:", {
					newAuthState,
					newConnectionStatus,
					previousIsConnected: isConnected,
				})

				// Always update profile data if we have complete Supabase user info
				if (message.softcodesUserInfo && (message.isConnected || message.isAuthenticated)) {
					const userInfo = message.softcodesUserInfo
					console.log("📊 [ProfileView] Updating profile with Supabase user info:", userInfo)

					const updatedProfileData = {
						kilocodeToken: apiConfiguration?.kilocodeToken || "",
						user: {
							id: userInfo.clerkId || "",
							email: userInfo.email,
							name: userInfo.firstName
								? `${userInfo.firstName} ${userInfo.lastName || ""}`.trim()
								: userInfo.email,
							image: userInfo.avatarUrl || "",
						},
						planType: userInfo.planType,
						credits: userInfo.credits,
					}

					setProfileData(updatedProfileData)
					setIsConnected(!!userInfo.planType) // Full connection if planType available
					setIsLoadingUser(false)

					console.log("🔗 [ProfileView] Updated profile with full Supabase data")
				}
			} else if (message.type === "connectionStatusChanged") {
				console.log("🔔 [ProfileView] Received connectionStatusChanged message:", {
					isConnected: message.isConnected,
					hasAuthState: !!message.authenticationState,
				})
				setIsConnected(message.isConnected || false)
				setAuthState(message.authenticationState)
			} else if (message.type === "forceLogout") {
				console.log("🛑 [ProfileView] Received forceLogout message - stopping all polling and clearing state")
				// Clear all state immediately and stop any ongoing polling
				setProfileData(null)
				setAuthState(null)
				setIsConnected(false)
				setIsLoadingUser(false)
				console.log("✅ [ProfileView] Force logout completed - state cleared")
			} else if (message.type === "softcodesBalanceUpdate") {
				console.log("🔔 [ProfileView] Received softcodesBalanceUpdate message:", message.credits)
				setCreditBalance(message.credits ?? null)
				if (profileData) {
					setProfileData({
						...profileData,
						credits: message.credits,
					})
				}
			} else if (message.type === "testAnalyticsResponse") {
				console.log("📊 [ProfileView] Received testAnalyticsResponse:", message.testAnalyticsResult)
				if (message.testAnalyticsResult?.success) {
					console.log("✅ [ProfileView] Analytics Test Successful!")
					console.log("User Analytics:", message.testAnalyticsResult.userResult)
					if (message.testAnalyticsResult.orgResult) {
						console.log("Org Analytics:", message.testAnalyticsResult.orgResult)
					}
				} else {
					console.error("❌ [ProfileView] Analytics Test Failed:", message.testAnalyticsResult?.error)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [apiConfiguration?.kilocodeToken])

	const user = profileData?.user

	// Token validation and persistence logic
	const hasValidToken = React.useMemo(() => {
		return !!(apiConfiguration?.kilocodeToken && apiConfiguration.kilocodeToken.length > 0)
	}, [apiConfiguration?.kilocodeToken])

	// Determine final connection status based on multiple factors
	const finalConnectionStatus = React.useMemo(() => {
		// Priority: profileData.planType/credits > authState connection > explicit isConnected > has valid token + user data
		if (profileData?.planType || profileData?.credits !== undefined) {
			return true // Full Supabase data available
		}
		if (authState?.isConnected) {
			return true // Explicit connection from auth state
		}
		if (isConnected && user) {
			return true // Explicit connection status with user data
		}
		if (hasValidToken && user && user.email) {
			return true // Valid token with complete user data suggests connection
		}
		return false
	}, [profileData, authState, isConnected, user, hasValidToken])

	// Manual refresh function with loading states
	const handleManualRefresh = React.useCallback(() => {
		console.log("🔄 [ProfileView] Manual refresh triggered")
		setIsLoadingUser(true)
		fetchAllData()
	}, [fetchAllData])

	function handleLogout(): void {
		console.info("🚀 [ProfileView] Logout button clicked - Initiating logout sequence...", {
			currentApiConfigName,
			hasApiConfiguration: !!apiConfiguration,
			currentTokenLength: apiConfiguration?.kilocodeToken ? apiConfiguration.kilocodeToken.length : 0,
			timestamp: new Date().toISOString(),
		})

		// Immediately stop any ongoing fetches by setting a guard
		console.log("🛑 [ProfileView] Setting logout in progress flag to block further fetches")

		// Clear all local state immediately
		console.log("🧹 [ProfileView] Clearing local state...")
		setProfileData(null)
		setAuthState(null)
		setIsConnected(false)
		setIsLoadingUser(true) // Show loading to indicate action is happening

		// Send dedicated logout message instead of upsertApiConfiguration
		console.log("📨 [ProfileView] Sending softcodesSignOut message to extension...")
		vscode.postMessage({
			type: "softcodesSignOut" as const,
		})

		console.log("⏳ [ProfileView] Logout message sent - waiting for authStateChanged response...")

		// Optional: Listen for confirmation or error
		const handleLogoutResponse = (event: MessageEvent) => {
			const message = event.data
			console.log("📨 [ProfileView] Received response after logout:", message.type, message)

			if (message.type === "authStateChanged") {
				console.log("✅ [ProfileView] Received authStateChanged after logout:", {
					isAuthenticated: message.isAuthenticated,
					isConnected: message.isConnected,
					signedOut: message.signedOut,
					hasError: !!message.error,
				})

				// Update local state based on response
				setIsConnected(message.isConnected || false)
				setAuthState(message.authenticationState)

				if (!message.isAuthenticated) {
					console.log("✅ [ProfileView] Logout confirmed - user is no longer authenticated")
					setIsLoadingUser(false)
				} else {
					console.warn("⚠️ [ProfileView] Logout response indicates still authenticated - state mismatch!")
				}
			} else if (message.type === "forceLogout") {
				console.log("🛑 [ProfileView] Received forceLogout message - stopping all polling and clearing state")
				// Clear all state immediately and stop any ongoing polling
				setProfileData(null)
				setAuthState(null)
				setIsConnected(false)
				setIsLoadingUser(false)
				console.log("✅ [ProfileView] Force logout completed - state cleared")
			} else if (message.type === "profileDataResponse") {
				if (!message.payload.success) {
					console.log(
						"📡 [ProfileView] Profile fetch blocked after logout as expected:",
						message.payload.error,
					)
				}
			}
		}

		// Listen for response for 10 seconds
		window.addEventListener("message", handleLogoutResponse)

		// Cleanup listener after 10 seconds
		setTimeout(() => {
			window.removeEventListener("message", handleLogoutResponse)
			console.log("🧹 [ProfileView] Logout response listener cleaned up")
			setIsLoadingUser(false)
		}, 10000)
	}

	// Enhanced debug logging
	console.log("🔍 [ProfileView] Current state:", {
		isLoadingUser,
		hasUser: !!user,
		hasValidToken,
		isConnected,
		finalConnectionStatus,
		hasAuthState: !!authState,
		hasSupabaseData: !!authState?.supabaseUserData,
		authStateConnection: authState?.isConnected,
		profileData,
		lastRefreshTime: new Date(lastRefreshRef.current).toISOString(),
		apiConfigurationToken: apiConfiguration?.kilocodeToken ? "present" : "missing",
	})

	if (isLoadingUser) {
		return <></>
	}

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center">
				<h3 className="text-vscode-foreground m-0">{t("kilocode:profile.title")}</h3>
				<Button onClick={onDone}>{t("settings:common.done")}</Button>
			</TabHeader>
			<TabContent>
				<div className="h-full flex flex-col">
					<div className="flex-1">
						{user ? (
							<div className="flex flex-col space-y-6 pr-3 h-full animate-fade-in">
								{/* Connection Status Card */}
								<div
									className={`profile-card p-4 ${finalConnectionStatus ? "connection-status-connected" : "connection-status-partial"}`}>
									<div className="flex items-center gap-3">
										<div className="flex-shrink-0">
											<div className="relative">
												<div
													className={`w-3 h-3 rounded-full ${finalConnectionStatus ? "bg-vscode-charts-green" : "bg-vscode-charts-yellow"}`}></div>
												<div
													className={`absolute inset-0 w-3 h-3 rounded-full ${finalConnectionStatus ? "bg-vscode-charts-green" : "bg-vscode-charts-yellow"} animate-pulse opacity-50`}></div>
											</div>
										</div>
										<div className="flex-1">
											<div className="flex items-center gap-2 mb-1">
												<span
													className="text-sm font-semibold"
													style={{
														color: finalConnectionStatus
															? "var(--vscode-charts-green)"
															: "var(--vscode-charts-yellow)",
													}}>
													{finalConnectionStatus ? "Connected" : "Authenticated"}
												</span>
												{hasValidToken && (
													<span className="text-xs px-2 py-0.5 rounded-full bg-vscode-button-background/20 text-vscode-button-foreground/70">
														Token Valid
													</span>
												)}
											</div>
											<div className="text-xs text-vscode-descriptionForeground">
												{finalConnectionStatus
													? "Full access to Softcodes features"
													: "Limited access - account setup needed"}
											</div>
										</div>
										<div className="flex-shrink-0">
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 hover:bg-vscode-button-foreground/10"
												onClick={handleManualRefresh}
												title="Refresh connection status">
												<span className="codicon codicon-refresh text-vscode-descriptionForeground"></span>
											</Button>
										</div>
									</div>
								</div>

								{/* User Profile Card */}
								<div className="profile-card p-6">
									<div className="flex items-start gap-4">
										{user.image ? (
											<div className="profile-avatar-ring">
												<div className="profile-avatar-ring-inner">
													<img
														src={user.image}
														alt="Profile"
														className="size-16 rounded-full object-cover"
													/>
												</div>
											</div>
										) : (
											<div className="profile-avatar-ring">
												<div className="profile-avatar-ring-inner">
													<div className="size-16 rounded-full bg-vscode-button-background flex items-center justify-center text-2xl font-semibold text-vscode-button-foreground">
														{user.name?.[0] || user.email?.[0] || "?"}
													</div>
												</div>
											</div>
										)}

										<div className="flex-1 min-w-0">
											{user.name && (
												<h2 className="text-vscode-foreground m-0 mb-2 text-xl font-semibold leading-tight">
													{user.name}
												</h2>
											)}

											{user.email && (
												<div className="text-sm text-vscode-descriptionForeground mb-3 break-all">
													{user.email}
												</div>
											)}

											{/* Enhanced Plan and Credits Display */}
											{finalConnectionStatus && authState?.supabaseUserData && (
												<div className="flex flex-wrap gap-2">
													{authState.supabaseUserData.plan_type && (
														<div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-vscode-badge-background text-vscode-badge-foreground border border-vscode-panel-border">
															<span className="mr-1">💼</span>
															{authState.supabaseUserData.plan_type
																.charAt(0)
																.toUpperCase() +
																authState.supabaseUserData.plan_type.slice(1)}{" "}
															Plan
														</div>
													)}
													{authState.supabaseUserData.credits !== undefined &&
														authState.supabaseUserData.credits !== null && (
															<div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-vscode-charts-green/10 text-vscode-charts-green border border-vscode-charts-green/20">
																<span className="mr-1">⚡</span>
																{creditBalance !== null
																	? Number(creditBalance).toFixed(2)
																	: Number(
																			authState.supabaseUserData.credits,
																		).toFixed(2)}{" "}
																credits
															</div>
														)}
												</div>
											)}
										</div>
									</div>
								</div>

								{/* Action Buttons Card */}
								<div className="profile-card p-4">
									<div className="flex gap-3 flex-col sm:flex-row">
										<Button
											asChild
											variant="default"
											size="default"
											className="flex-1 h-10 font-medium">
											<a
												href="https://www.softcodes.ai/dashboard"
												target="_blank"
												rel="noopener noreferrer">
												<span className="codicon codicon-dashboard mr-2"></span>
												{t("kilocode:profile.dashboard")}
											</a>
										</Button>
										<Button
											variant="outline"
											size="default"
											onClick={(e) => {
												e.preventDefault()
												console.log("🔧 [ProfileView] Logout button clicked")
												handleLogout()
											}}
											className="flex-1 h-10 font-medium hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors">
											<span className="codicon codicon-sign-out mr-2"></span>
											{t("kilocode:profile.logOut")}
										</Button>
									</div>
									<div className="mt-3">
										<Button
											variant="secondary"
											size="default"
											onClick={(e) => {
												e.preventDefault()
												console.log("🧪 [ProfileView] Test Analytics button clicked")
												vscode.postMessage({ type: "testAnalytics" })
											}}
											className="w-full h-10 font-medium">
											<span className="codicon codicon-graph mr-2"></span>
											Test Analytics
										</Button>
									</div>
								</div>

								{/* Setup Prompt Card for non-connected users */}
								{!finalConnectionStatus && hasValidToken && (
									<div className="profile-card p-6 border-vscode-charts-yellow/30 bg-vscode-charts-yellow/5">
										<div className="text-center">
											<div className="mb-4">
												<span className="text-4xl">🔄</span>
											</div>
											<div className="text-lg font-semibold text-vscode-foreground mb-2">
												Verifying Connection
											</div>
											<div className="text-sm text-vscode-descriptionForeground mb-6 leading-relaxed">
												Your token is valid but the connection is being verified. This should
												complete automatically.
											</div>
											<Button
												variant="outline"
												size="default"
												onClick={handleManualRefresh}
												className="font-medium">
												<span className="codicon codicon-refresh mr-2"></span>
												Retry Connection
											</Button>
										</div>
									</div>
								)}

								{/* Setup Prompt Card for users without valid tokens */}
								{!finalConnectionStatus && !hasValidToken && (
									<div className="profile-card p-6 border-vscode-charts-yellow/30 bg-vscode-charts-yellow/5">
										<div className="text-center">
											<div className="mb-4">
												<span className="text-4xl">🚀</span>
											</div>
											<div className="text-lg font-semibold text-vscode-foreground mb-2">
												Account Setup Required
											</div>
											<div className="text-sm text-vscode-descriptionForeground mb-6 leading-relaxed">
												Complete your account setup to access all Softcodes features, including
												credits and premium plans.
											</div>
											<Button asChild variant="default" size="lg" className="font-medium">
												<a
													href="https://softcodes.ai/setup"
													target="_blank"
													rel="noopener noreferrer">
													<span className="codicon codicon-arrow-right mr-2"></span>
													Complete Setup
												</a>
											</Button>
										</div>
									</div>
								)}
							</div>
						) : (
							<div className="flex flex-col items-center pr-3 animate-fade-in">
								<div className="profile-card p-6 w-full">
									<KiloCodeAuth className="w-full" />
								</div>
							</div>
						)}
					</div>
				</div>
			</TabContent>
		</Tab>
	)
}

export default ProfileView
