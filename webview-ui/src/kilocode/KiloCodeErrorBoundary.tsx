import * as React from "react"

type Props = {
	children: React.ReactNode
}

type State = {
	error?: string
}

export class KiloCodeErrorBoundary extends React.Component<Props, State> {
	constructor(props: Props) {
		super(props)
		this.state = {}
	}

	static getDerivedStateFromError(error: unknown) {
		return {
			error: error instanceof Error ? (error.stack ?? error.message) : `${error}`,
		}
	}

	render() {
		if (!this.state.error) {
			return this.props.children
		}
		return this.state.error
	}
}
