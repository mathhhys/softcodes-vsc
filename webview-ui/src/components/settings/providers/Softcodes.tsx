import React, { useState, useEffect } from "react"
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import SoftcodesBalanceDisplay from "./SoftcodesBalanceDisplay"

interface SoftcodesProviderProps {
	apiConfiguration: any
	setApiConfiguration: (config: any) => void
	vscode: any
}

export default function SoftcodesProvider({ apiConfiguration, setApiConfiguration, vscode }: SoftcodesProviderProps) {
	const { t } = useTranslation()
	const { blueByteBoosterAuth } = useExtensionState()
	const [isLoading, setIsLoading] = useState(false)

	const handleLogin = () => {
		setIsLoading(true)
		vscode.postMessage({
			type: "blueByteBoosterLogin",
		})
		// Reset loading state after timeout
		setTimeout(() => setIsLoading(false), 3000)
	}

	const handleLogout = () => {
		if (confirm(t("settings.providers.softcodes.confirmLogout") || "Are you sure you want to logout?")) {
			vscode.postMessage({
				type: "blueByteBoosterLogout",
			})
		}
	}

	const handleRefresh = () => {
		vscode.postMessage({
			type: "refreshBlueByteBoosterAuth",
		})
	}

	const handleManageAccount = () => {
		vscode.postMessage({
			type: "openExternal",
			url: "https://softcodes.ai/dashboard",
		})
	}

	// If no auth state available, show nothing
	if (!blueByteBoosterAuth) {
		return null
	}

	// Not authenticated - show login UI
	if (!blueByteBoosterAuth.isAuthenticated || !blueByteBoosterAuth.user) {
		return (
			<div className="space-y-4">
				<div className="text-sm text-vscode-descriptionForeground mb-3">
					Sign in to Softcodes to access your credits and premium features.
				</div>

				<VSCodeButton onClick={handleLogin} disabled={isLoading} className="w-full">
					{isLoading ? "Opening browser..." : "Sign In with Softcodes"}
				</VSCodeButton>

				<p className="text-xs text-vscode-descriptionForeground text-center">
					Don't have an account?{" "}
					<a
						href="#"
						onClick={(e) => {
							e.preventDefault()
							vscode.postMessage({
								type: "openExternal",
								url: "https://softcodes.ai/sign-up",
							})
						}}
						className="text-vscode-textLink-foreground hover:underline">
						Sign up for free
					</a>
				</p>

				<div className="text-xs text-vscode-descriptionForeground mt-4 p-3 bg-vscode-textBlockQuote-background rounded">
					<p className="font-medium mb-2">✨ Benefits:</p>
					<ul className="list-disc list-inside space-y-1">
						<li>Access to premium AI models</li>
						<li>Credit-based billing system</li>
						<li>Team collaboration features</li>
						<li>Priority support</li>
					</ul>
				</div>
			</div>
		)
	}

	// Authenticated - show user info and credits
	const { user } = blueByteBoosterAuth

	return (
		<div className="space-y-4">
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings.providers.softcodes.description")}
			</div>

			{/* User Info Card */}
			<div className="bg-vscode-editor-background p-3 rounded border border-vscode-panel-border">
				<div className="flex items-center justify-between mb-2">
					<span className="text-sm text-vscode-descriptionForeground">Signed in as</span>
					<VSCodeButton appearance="icon" onClick={handleRefresh} title="Refresh auth status">
						↻
					</VSCodeButton>
				</div>

				<div className="space-y-1 mb-3">
					<p className="font-medium">{user.username || user.email}</p>
					<p className="text-sm text-vscode-descriptionForeground">{user.email}</p>
				</div>

				{/* Credits and Plan Display */}
				<div className="bg-vscode-editor-background p-3 rounded border border-vscode-panel-border">
					<div className="flex items-center justify-between">
						<div>
							<p className="text-sm text-vscode-descriptionForeground mb-1">Available Credits</p>
							<p className="text-2xl font-bold text-vscode-textLink-activeForeground">
								{user.credits.toLocaleString()}
							</p>
						</div>
						<div className="text-right">
							<p className="text-sm text-vscode-descriptionForeground mb-1">Plan</p>
							<p className="text-sm font-semibold capitalize">{user.plan_type}</p>
						</div>
					</div>
				</div>

				{/* Actions */}
				<div className="flex gap-2 mt-3">
					<VSCodeButton className="flex-1" onClick={handleManageAccount}>
						Manage Account
					</VSCodeButton>
					<VSCodeButton appearance="secondary" onClick={handleLogout}>
						Logout
					</VSCodeButton>
				</div>
			</div>

			<SoftcodesBalanceDisplay vscode={vscode} />

			<div className="space-y-2">
				<label className="text-sm font-medium">{t("settings.providers.softcodes.endpoint")}</label>
				<VSCodeTextField
					value={apiConfiguration.softcodesEndpoint || "https://softcodes.ai"}
					onChange={(e: any) => {
						setApiConfiguration({
							...apiConfiguration,
							softcodesEndpoint: e.target.value,
						})
					}}
					placeholder="https://softcodes.ai"
					className="w-full"
				/>
				<p className="text-xs text-vscode-descriptionForeground">
					{t("settings.providers.softcodes.endpointDescription")}
				</p>
			</div>

			<div className="mt-4 p-3 bg-vscode-textBlockQuote-background rounded">
				<p className="text-xs text-vscode-descriptionForeground">{t("settings.providers.softcodes.note")}</p>
			</div>
		</div>
	)
}
