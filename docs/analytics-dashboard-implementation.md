# Analytics Dashboard Implementation Guide

This guide provides the necessary code and steps to implement the per-seat analytics dashboard in the `blue-byte-booster` repository.

## Prerequisites

Ensure you have run the database migration `016_monthly_analytics_tables.sql` in your Supabase project and that the `populate_monthly_analytics` function has been executed to populate the tables with initial data.

## Task List

- [ ]   1. Add the TypeScript interfaces for the analytics data.
- [ ]   2. Create the Supabase data fetching hooks/services.
- [ ]   3. Build the `OrganizationOverview` component.
- [ ]   4. Build the `SeatUsageTable` component.
- [ ]   5. Build the `ModelUsageBreakdown` component.
- [ ]   6. Integrate these components into your main Organization Dashboard page.

---

## 1. TypeScript Interfaces

Add these types to your frontend project (e.g., `src/types/analytics.ts`):

```typescript
export interface MonthlyOrgAnalytics {
	id: string
	organization_id: string
	year_month: string
	total_credits_used: number
	total_usd_spent: number
	total_requests: number
	total_input_tokens: number
	total_output_tokens: number
	seat_count: number
	created_at: string
	updated_at: string
}

export interface MonthlySeatAnalytics {
	id: string
	organization_id: string
	user_id: string
	year_month: string
	total_credits_used: number
	total_usd_spent: number
	total_requests: number
	total_input_tokens: number
	total_output_tokens: number
	created_at: string
	updated_at: string
	// Joined fields
	users?: {
		clerk_id: string
		email?: string
		name?: string
	}
}

export interface MonthlyOrgModelUsage {
	id: string
	organization_id: string
	model_id: string
	provider: string
	year_month: string
	total_credits_used: number
	total_usd_spent: number
	total_requests: number
	total_input_tokens: number
	total_output_tokens: number
	created_at: string
	updated_at: string
}
```

---

## 2. Supabase Data Fetching Hooks

Create a hook to fetch the analytics data (e.g., `src/hooks/useAnalytics.ts`):

```typescript
import { useState, useEffect } from "react"
import { supabase } from "@/utils/supabase/client" // Adjust import based on your setup
import { MonthlyOrgAnalytics, MonthlySeatAnalytics, MonthlyOrgModelUsage } from "@/types/analytics"

export function useAnalytics(organizationId: string, yearMonth: string) {
	const [orgAnalytics, setOrgAnalytics] = useState<MonthlyOrgAnalytics | null>(null)
	const [seatAnalytics, setSeatAnalytics] = useState<MonthlySeatAnalytics[]>([])
	const [modelUsage, setModelUsage] = useState<MonthlyOrgModelUsage[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		async function fetchAnalytics() {
			if (!organizationId || !yearMonth) return

			setIsLoading(true)
			setError(null)

			try {
				// 1. Fetch Org Overview
				const { data: orgData, error: orgError } = await supabase
					.from("monthly_org_analytics")
					.select("*")
					.eq("organization_id", organizationId)
					.eq("year_month", yearMonth)
					.single()

				if (orgError && orgError.code !== "PGRST116") throw orgError
				setOrgAnalytics(orgData)

				// 2. Fetch Seat Usage (with user details)
				const { data: seatData, error: seatError } = await supabase
					.from("monthly_seat_analytics")
					.select(
						`
            *,
            users (
              clerk_id
            )
          `,
					)
					.eq("organization_id", organizationId)
					.eq("year_month", yearMonth)
					.order("total_credits_used", { ascending: false })

				if (seatError) throw seatError
				setSeatAnalytics(seatData as any)

				// 3. Fetch Model Usage
				const { data: modelData, error: modelError } = await supabase
					.from("monthly_org_model_usage")
					.select("*")
					.eq("organization_id", organizationId)
					.eq("year_month", yearMonth)
					.order("total_credits_used", { ascending: false })

				if (modelError) throw modelError
				setModelUsage(modelData)
			} catch (err: any) {
				console.error("Error fetching analytics:", err)
				setError(err.message)
			} finally {
				setIsLoading(false)
			}
		}

		fetchAnalytics()
	}, [organizationId, yearMonth])

	return { orgAnalytics, seatAnalytics, modelUsage, isLoading, error }
}
```

---

## 3. Organization Overview Component

Create `src/components/analytics/OrganizationOverview.tsx`:

```tsx
import React from "react"
import { MonthlyOrgAnalytics } from "@/types/analytics"

interface Props {
	data: MonthlyOrgAnalytics | null
}

export function OrganizationOverview({ data }: Props) {
	if (!data) {
		return (
			<div className="p-4 border border-white/10 rounded-lg bg-[#2a2a2a] text-gray-400">
				No data available for this month.
			</div>
		)
	}

	return (
		<div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
			<div className="p-6 border border-white/10 rounded-lg bg-[#2a2a2a] shadow-sm">
				<h3 className="text-sm font-medium text-gray-400">Total Credits Used</h3>
				<p className="text-3xl font-bold mt-2 text-white">{Number(data.total_credits_used).toLocaleString()}</p>
			</div>

			<div className="p-6 border border-white/10 rounded-lg bg-[#2a2a2a] shadow-sm">
				<h3 className="text-sm font-medium text-gray-400">Total API Requests</h3>
				<p className="text-3xl font-bold mt-2 text-white">{data.total_requests.toLocaleString()}</p>
			</div>

			<div className="p-6 border border-white/10 rounded-lg bg-[#2a2a2a] shadow-sm">
				<h3 className="text-sm font-medium text-gray-400">Active Seats</h3>
				<p className="text-3xl font-bold mt-2 text-white">{data.seat_count}</p>
			</div>

			<div className="p-6 border border-white/10 rounded-lg bg-[#2a2a2a] shadow-sm">
				<h3 className="text-sm font-medium text-gray-400">Avg Credits / Seat</h3>
				<p className="text-3xl font-bold mt-2 text-white">
					{data.seat_count > 0 ? (Number(data.total_credits_used) / data.seat_count).toFixed(2) : "0"}
				</p>
			</div>
		</div>
	)
}
```

---

## 4. Seat Usage Table Component

Create `src/components/analytics/SeatUsageTable.tsx`:

```tsx
import React from "react"
import { MonthlySeatAnalytics } from "@/types/analytics"

interface Props {
	data: MonthlySeatAnalytics[]
}

export function SeatUsageTable({ data }: Props) {
	if (data.length === 0) return null

	return (
		<div className="mb-8">
			<h2 className="text-xl font-semibold mb-4 text-white">Usage by Seat</h2>
			<div className="overflow-x-auto border border-white/10 rounded-lg">
				<table className="min-w-full divide-y divide-white/10">
					<thead className="bg-[#1a1a1a]">
						<tr>
							<th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
								User ID
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
								Credits Used
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
								Requests
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
								Total Tokens
							</th>
						</tr>
					</thead>
					<tbody className="bg-[#2a2a2a] divide-y divide-white/10">
						{data.map((seat) => (
							<tr key={seat.id}>
								<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
									{seat.users?.clerk_id || seat.user_id}
								</td>
								<td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-400">
									{Number(seat.total_credits_used).toLocaleString()}
								</td>
								<td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-400">
									{seat.total_requests.toLocaleString()}
								</td>
								<td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-400">
									{(
										Number(seat.total_input_tokens) + Number(seat.total_output_tokens)
									).toLocaleString()}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
```

---

## 5. Model Usage Breakdown Component

Create `src/components/analytics/ModelUsageBreakdown.tsx`:

```tsx
import React from "react"
import { MonthlyOrgModelUsage } from "@/types/analytics"

interface Props {
	data: MonthlyOrgModelUsage[]
}

export function ModelUsageBreakdown({ data }: Props) {
	if (data.length === 0) return null

	return (
		<div className="mb-8">
			<h2 className="text-xl font-semibold mb-4 text-white">Model Usage Breakdown</h2>
			<div className="overflow-x-auto border border-white/10 rounded-lg">
				<table className="min-w-full divide-y divide-white/10">
					<thead className="bg-[#1a1a1a]">
						<tr>
							<th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
								Model
							</th>
							<th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
								Provider
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
								Credits Used
							</th>
							<th className="px-6 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider">
								Requests
							</th>
						</tr>
					</thead>
					<tbody className="bg-[#2a2a2a] divide-y divide-white/10">
						{data.map((model) => (
							<tr key={model.id}>
								<td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
									{model.model_id}
								</td>
								<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">{model.provider}</td>
								<td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-400">
									{Number(model.total_credits_used).toLocaleString()}
								</td>
								<td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-400">
									{model.total_requests.toLocaleString()}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	)
}
```

---

## 6. Integration into Dashboard Page

Finally, integrate these components into your main dashboard page (`src/pages/Dashboard.tsx`).

First, add the necessary imports at the top of the file:

```tsx
import { useAnalytics } from "@/hooks/useAnalytics"
import { OrganizationOverview } from "@/components/analytics/OrganizationOverview"
import { SeatUsageTable } from "@/components/analytics/SeatUsageTable"
import { ModelUsageBreakdown } from "@/components/analytics/ModelUsageBreakdown"
```

Then, inside the `Dashboard` component, add the state for the month selector and call the `useAnalytics` hook:

```tsx
// Analytics state
const [yearMonth, setYearMonth] = useState(() => {
	const now = new Date()
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
})

const {
	orgAnalytics,
	seatAnalytics,
	modelUsage,
	isLoading: isLoadingAnalytics,
	error: analyticsError,
} = useAnalytics(organization?.id || "", yearMonth)
```

Finally, replace the existing "Usage View" section (around line 1230) with the new components:

```tsx
{
	/* Usage View */
}
;<div className="mb-8">
	<div className="flex items-center justify-between mb-6">
		<h2 className="text-2xl font-bold text-white">Analytics</h2>

		{/* Month Selector */}
		<input
			type="month"
			value={yearMonth}
			onChange={(e) => setYearMonth(e.target.value)}
			className="bg-[#1a1a1a] border border-white/10 text-white rounded-md px-3 py-2"
		/>
	</div>

	{isLoadingAnalytics ? (
		<div className="p-8 text-center text-gray-400">Loading analytics...</div>
	) : analyticsError ? (
		<div className="p-8 text-red-500">Error: {analyticsError}</div>
	) : (
		<>
			<OrganizationOverview data={orgAnalytics} />

			<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
				<SeatUsageTable data={seatAnalytics} />
				<ModelUsageBreakdown data={modelUsage} />
			</div>
		</>
	)}
</div>
```
