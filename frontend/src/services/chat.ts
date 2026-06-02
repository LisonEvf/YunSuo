const API_BASE = import.meta.env.VITE_API_BASE || ''

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export async function fetchSkills() {
  const res = await fetch(`${API_BASE}/api/skills`)
  if (!res.ok) throw new Error('Failed to fetch skills')
  return res.json() as Promise<{ skills: Array<{ slug: string; name: string; description: string }> }>
}

export async function sendChat(
  messages: ChatMessage[],
  skills?: string[],
  onDelta?: (text: string) => void,
  onDone?: () => void,
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, stream: true, skills: skills?.length ? skills : undefined }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }

  const decoder = new TextDecoder()
  const reader = res.body!.getReader()
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue
      try {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'delta' && event.content) {
          fullContent += event.content
          onDelta?.(fullContent)
        }
        if (event.type === 'done') {
          onDone?.()
        }
      } catch {
        // skip malformed
      }
    }
  }
  return fullContent
}
