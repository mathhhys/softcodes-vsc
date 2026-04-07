import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { useOpenRouterKeyInfo } from "@/components/ui/hooks/useOpenRouterKeyInfo"

export const OpenRouterBalanceDisplay = ({ apiKey, baseUrl }: { apiKey: string; baseUrl?: string }) => {
	const { data: keyInfo } = useOpenRouterKeyInfo(apiKey, baseUrl)

	if (!keyInfo || !keyInfo.limit) {
		return null
	}

	const remainingDollars = keyInfo.limit - keyInfo.usage
	const remainingCredits = remainingDollars / 0.014
	const formattedCredits = remainingCredits.toFixed(2)

	return (
		<VSCodeLink href="https://openrouter.ai/settings/keys" className="text-vscode-foreground hover:underline">
			{formattedCredits} credits
		</VSCodeLink>
	)
}
