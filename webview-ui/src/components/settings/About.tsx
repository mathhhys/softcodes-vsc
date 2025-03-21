import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Info } from "lucide-react"

import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type AboutProps = HTMLAttributes<HTMLDivElement> & {
	version: string
}

export const About = ({ version, className, ...props }: AboutProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader description={`Version: ${version}`}>
				<div className="flex items-center gap-2">
					<Info className="w-4" />
					<div>{t("settings:sections.about")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<Trans
						i18nKey="settings:footer.feedback"
						components={{
							githubLink: <VSCodeLink href="https://github.com/Kilo-Org/kilocode" />,
							redditLink: <VSCodeLink href="https://reddit.com/r/kilocode" />,
							discordLink: <VSCodeLink href="https://discord.gg/fxrhCFGhkP" />,
						}}
					/>
				</div>

				<div className="flex justify-between items-center gap-3">
					<p>{t("settings:footer.reset.description")}</p>
					<VSCodeButton
						onClick={() => vscode.postMessage({ type: "resetState" })}
						appearance="secondary"
						className="shrink-0">
						<span className="codicon codicon-warning text-vscode-errorForeground mr-1" />
						{t("settings:footer.reset.button")}
					</VSCodeButton>
				</div>
			</Section>
		</div>
	)
}
