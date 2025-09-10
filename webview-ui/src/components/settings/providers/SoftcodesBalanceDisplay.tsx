import React, { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"

interface SoftcodesBalanceDisplayProps {
	vscode: any
}

interface BalanceInfo {
	credits: number
	plan: string
	isUnlimited: boolean
}

export default function SoftcodesBalanceDisplay({ vscode }: SoftcodesBalanceDisplayProps) {
	const { t } = useTranslation()
	const [balance, setBalance] = useState<BalanceInfo | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		// Request balance information on mount
		fetchBalance()

		// Listen for balance updates
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "softcodesBalanceUpdate") {
				setBalance(message.balance)
				setIsLoading(false)
				setError(null)
			} else if (message.type === "softcodesBalanceError") {
				setError(message.error)
				setIsLoading(false)
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const fetchBalance = () => {
		setIsLoading(true)
		setError(null)
		vscode.postMessage({
			type: "getSoftcodesBalance",
		})
	}

	if (isLoading) {
		return (
			<div className="bg-vscode-editor-background p-3 rounded border border-vscode-panel-border">
				<div className="flex items-center space-x-2">
					<div className="animate-spin h-4 w-4 border-2 border-vscode-progressBar-background border-t-transparent rounded-full"></div>
					<span className="text-sm">{t("common.loading")}</span>
				</div>
			</div>
		)
	}

	if (error) {
		return (
			<div className="bg-vscode-inputValidation-errorBackground p-3 rounded border border-vscode-inputValidation-errorBorder">
				<div className="flex justify-between items-center">
					<span className="text-sm text-vscode-inputValidation-errorForeground">
						{t("settings.providers.softcodes.balanceError")}: {error}
					</span>
					<button
						onClick={fetchBalance}
						className="text-xs underline text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
						{t("common.retry")}
					</button>
				</div>
			</div>
		)
	}

	if (!balance) {
		return (
			<div className="bg-vscode-editor-background p-3 rounded border border-vscode-panel-border">
				<span className="text-sm text-vscode-descriptionForeground">
					{t("settings.providers.softcodes.noBalanceInfo")}
				</span>
			</div>
		)
	}

	return (
		<div className="bg-vscode-editor-background p-3 rounded border border-vscode-panel-border">
			<div className="flex justify-between items-center">
				<div>
					<p className="text-sm font-medium">
						{t("settings.providers.softcodes.plan")}: {balance.plan}
					</p>
					{balance.isUnlimited ? (
						<p className="text-sm text-vscode-descriptionForeground">
							{t("settings.providers.softcodes.unlimitedCredits")}
						</p>
					) : (
						<p className="text-sm text-vscode-descriptionForeground">
							{t("settings.providers.softcodes.credits")}: {balance.credits.toLocaleString()}
						</p>
					)}
				</div>
				<button
					onClick={fetchBalance}
					className="text-xs underline text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground">
					{t("common.refresh")}
				</button>
			</div>
		</div>
	)
}
