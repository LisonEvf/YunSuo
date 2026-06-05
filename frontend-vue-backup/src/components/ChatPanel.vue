<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { sendChat, fetchSkills, type ChatMessage } from '../services/chat'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const input = ref('')
const messages = ref<Array<{ role: 'user' | 'assistant'; content: string }>>([])
const loading = ref(false)
const chatRef = ref<HTMLDivElement | null>(null)
const skills = ref<Array<{ slug: string; name: string; description: string }>>([])
const activeSkill = ref<string | null>(null)
const showSkills = ref(false)

fetchSkills().then(d => { skills.value = d.skills }).catch(() => {})

async function handleSend() {
  const text = input.value.trim()
  if (!text || loading.value) return
  input.value = ''
  messages.value.push({ role: 'user', content: text })
  messages.value.push({ role: 'assistant', content: '' })
  loading.value = true
  await nextTick()
  scrollToBottom()

  try {
    const skillList = activeSkill.value ? [activeSkill.value] : undefined
    await sendChat(
      messages.value.slice(0, -1).map(m => ({ role: m.role, content: m.content })),
      skillList,
      (full) => {
        messages.value[messages.value.length - 1].content = full
        scrollToBottom()
      },
    )
  } catch (e) {
    messages.value[messages.value.length - 1].content = `⚠️ ${e instanceof Error ? e.message : '请求失败'}`
  } finally {
    loading.value = false
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (chatRef.value) chatRef.value.scrollTop = chatRef.value.scrollHeight
  })
}

function toggleSkill(slug: string) {
  activeSkill.value = activeSkill.value === slug ? null : slug
  showSkills.value = false
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <aside v-if="visible" class="chat-panel">
    <header class="chat-header">
      <span>💡 情绪助手</span>
      <button @click="emit('close')" title="关闭">✕</button>
    </header>

    <div ref="chatRef" class="chat-body">
      <div v-if="!messages.length" class="chat-empty">
        <p>问我任何关于市场情绪的问题：</p>
        <ul>
          <li @click="input = '当前市场情绪周期如何？'; handleSend()">📊 当前情绪周期如何？</li>
          <li @click="input = '哪些板块值得关注？'; handleSend()">🔥 哪些板块值得关注？</li>
          <li @click="input = '明天应该怎么操作？'; handleSend()">📋 明天应该怎么操作？</li>
        </ul>
      </div>
      <div v-for="(msg, i) in messages" :key="i" class="chat-msg" :class="msg.role">
        <span class="msg-role">{{ msg.role === 'user' ? '你' : 'AI' }}</span>
        <div class="msg-content" v-html="msg.content.replace(/\n/g, '<br>')"></div>
      </div>
    </div>

    <div class="chat-skills" v-if="showSkills">
      <div v-for="s in skills" :key="s.slug" class="skill-option" :class="{ active: activeSkill === s.slug }" @click="toggleSkill(s.slug)">
        <b>{{ s.name }}</b>
        <span>{{ s.description }}</span>
      </div>
    </div>

    <footer class="chat-footer">
      <div v-if="activeSkill" class="active-skill-tag">
        {{ skills.find(s => s.slug === activeSkill)?.name }}
        <span @click="activeSkill = null">✕</span>
      </div>
      <div class="input-row">
        <button class="skill-btn" @click="showSkills = !showSkills" :class="{ active: showSkills || activeSkill }" title="技能">⚡</button>
        <textarea v-model="input" @keydown="handleKeydown" placeholder="输入问题..." rows="1" :disabled="loading" />
        <button class="send-btn" @click="handleSend" :disabled="!input.trim() || loading">{{ loading ? '...' : '→' }}</button>
      </div>
    </footer>
  </aside>
</template>

<style scoped>
.chat-panel {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 420px;
  max-height: 560px;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 18px;
  box-shadow: 0 12px 40px rgba(0,0,0,.35);
  z-index: 100;
  overflow: hidden;
}
.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
  font-weight: 700;
  font-size: var(--fs-md);
}
.chat-header button {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: var(--fs-lg);
  padding: 2px 6px;
  border-radius: 6px;
}
.chat-header button:hover { color: var(--color-pink); background: var(--bg-card); }

.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px;
  min-height: 280px;
  max-height: 360px;
}
.chat-empty { color: var(--text-secondary); font-size: var(--fs-sm); }
.chat-empty ul { list-style: none; padding: 0; margin-top: 12px; }
.chat-empty li {
  padding: 8px 12px;
  margin: 6px 0;
  border-radius: 8px;
  background: var(--bg-card);
  cursor: pointer;
  transition: background .15s;
}
.chat-empty li:hover { background: var(--soft-panel); color: var(--color-accent); }

.chat-msg { margin-bottom: 14px; }
.chat-msg.user { text-align: right; }
.msg-role { font-size: 11px; color: var(--text-muted); }
.msg-content {
  display: inline-block;
  max-width: 90%;
  margin-top: 4px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: var(--fs-sm);
  line-height: 1.6;
  text-align: left;
}
.chat-msg.user .msg-content { background: rgba(61,126,255,.15); color: var(--color-accent); }
.chat-msg.assistant .msg-content { background: var(--bg-card); color: var(--text-primary); }

.chat-skills {
  max-height: 200px;
  overflow-y: auto;
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-card);
}
.skill-option {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin: 4px 0;
  transition: background .15s;
}
.skill-option:hover { background: var(--soft-panel); }
.skill-option.active { background: var(--soft-panel); border: 1px solid var(--soft-panel-border); }
.skill-option b { display: block; font-size: var(--fs-sm); color: var(--text-primary); }
.skill-option span { font-size: 11px; color: var(--text-secondary); }

.chat-footer { padding: 10px 14px; border-top: 1px solid var(--border-color); }
.active-skill-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  margin-bottom: 8px;
  border-radius: 999px;
  background: var(--soft-panel);
  color: var(--color-accent);
  font-size: 11px;
  font-weight: 600;
}
.active-skill-tag span { cursor: pointer; }
.input-row { display: flex; gap: 8px; align-items: center; }
textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 8px 12px;
  font: inherit;
  font-size: var(--fs-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  outline: none;
  max-height: 80px;
}
textarea:focus { border-color: var(--color-accent); }
.skill-btn, .send-btn {
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: var(--fs-md);
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.skill-btn:hover, .send-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.skill-btn.active { background: var(--soft-panel); color: var(--color-accent); border-color: var(--soft-panel-border); }
.send-btn { background: var(--color-accent); color: #fff; border-color: var(--color-accent); }
.send-btn:disabled { opacity: .4; cursor: not-allowed; }

@media (max-width: 760px) {
  .chat-panel { width: calc(100vw - 48px); right: 24px; bottom: 16px; max-height: 480px; }
}
</style>
