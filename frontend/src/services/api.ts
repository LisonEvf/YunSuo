import type { DashboardData, TrendPoint } from '../types/dashboard'

const API_BASE = import.meta.env.VITE_API_BASE || ''

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail || `HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchDashboard(day?: string) {
  const query = day ? `?day=${encodeURIComponent(day)}` : ''
  return request<DashboardData>(`/api/dashboard${query}`)
}

export function fetchTrend(days = 15, day?: string) {
  const params = new URLSearchParams({ days: String(days) })
  if (day) params.set('day', day)
  return request<{ trend: TrendPoint[] }>(`/api/dashboard/trend?${params}`)
}
