<template>
  <div class="rdagent-page" :class="{ 'theme-dark': isDarkTheme }">
    <header class="page-header">
      <div>
        <span class="kicker">RD-Agent</span>
        <h1>研究工厂</h1>
        <p>通过本机 rdagent-bridge 启停因子挖掘任务，查看会话与日志。</p>
      </div>
      <div class="header-actions">
        <a-button icon="reload" :loading="refreshing" @click="refreshAll">刷新</a-button>
        <a-button icon="desktop" @click="openUi">打开 UI</a-button>
      </div>
    </header>

    <a-alert
      v-if="bridgeOffline"
      type="warning"
      show-icon
      banner
      class="bridge-alert"
      message="请先在本机启动 rdagent-bridge（端口 19901）"
      description="QuantDinger 后端仅代理请求；因子挖掘在本机宿主机执行，不在 Docker 容器内运行。"
    />

    <a-alert
      v-else
      type="info"
      show-icon
      class="host-note"
      message="因子挖掘在本机宿主机执行"
      description="研究进程通过 micromamba / rdagent 运行在宿主机工作区，QuantDinger Docker 后端不包含 RD-Agent 依赖。"
    />

    <section class="workspace-card">
      <h2 class="section-title">任务控制</h2>
      <a-form layout="inline" class="job-form">
        <a-form-item label="场景">
          <a-select v-model="form.scenario" :disabled="!!runningJob || bridgeOffline" style="width: 200px">
            <a-select-option v-for="item in scenarios" :key="item.value" :value="item.value">
              {{ item.label }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="步数 step_n">
          <a-input-number
            v-model="form.step_n"
            :min="1"
            :max="20"
            :disabled="!!runningJob || bridgeOffline"
          />
        </a-form-item>
        <a-form-item>
          <a-button
            type="primary"
            icon="play-circle"
            :loading="starting"
            :disabled="!!runningJob || bridgeOffline"
            @click="handleStart"
          >
            启动
          </a-button>
          <a-button
            icon="stop"
            :loading="stopping"
            :disabled="!runningJob"
            style="margin-left: 8px"
            @click="handleStop"
          >
            停止
          </a-button>
        </a-form-item>
      </a-form>

      <div v-if="statusData" class="status-row">
        <a-tag :color="bridgeConnected ? 'green' : 'red'">
          Bridge {{ bridgeConnected ? '已连接' : '未连接' }}
        </a-tag>
        <a-tag v-if="statusData.workspace_exists === false" color="orange">工作区不存在</a-tag>
        <template v-if="runningJob">
          <a-tag color="blue">运行中</a-tag>
          <span class="status-meta">任务 {{ runningJob.id }} · {{ runningJob.scenario || form.scenario }} · step {{ runningJob.step_n || form.step_n }}</span>
        </template>
        <span v-else class="status-meta">当前无运行中任务</span>
      </div>

      <div class="log-panel">
        <div class="log-header">
          <strong>日志尾部</strong>
          <a-tag v-if="runningJob" color="processing">每 3 秒刷新</a-tag>
        </div>
        <pre class="log-pre">{{ logText || '暂无日志' }}</pre>
      </div>
    </section>

    <section class="workspace-card sessions-card">
      <div class="section-head">
        <h2 class="section-title">历史会话</h2>
        <a-button size="small" icon="reload" :loading="sessionsLoading" @click="loadSessions">刷新</a-button>
      </div>
      <a-table
        row-key="id"
        size="middle"
        :loading="sessionsLoading"
        :columns="sessionColumns"
        :data-source="sessions"
        :pagination="{ pageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50'] }"
      />
    </section>
  </div>
</template>

<script>
import { mapState } from 'vuex'
import {
  fetchRdagentStatus,
  fetchRdagentJobLogs,
  fetchRdagentSessions,
  startRdagentJob,
  startRdagentUi,
  stopRdagentJob
} from '@/api/rdagent'
import { createVisibilityPolling } from '@/utils/visibilityPolling'

const UI_URL = 'http://127.0.0.1:19899'

export default {
  name: 'RdAgentLab',
  data () {
    return {
      bridgeOffline: false,
      refreshing: false,
      starting: false,
      stopping: false,
      sessionsLoading: false,
      statusData: null,
      runningJob: null,
      logText: '',
      sessions: [],
      form: {
        scenario: 'fin_factor',
        step_n: 1
      },
      scenarios: [
        { value: 'fin_factor', label: 'fin_factor（因子挖掘）' },
        { value: 'fin_quant', label: 'fin_quant（量化研究）' }
      ],
      sessionColumns: [
        { title: '会话 ID', dataIndex: 'id', key: 'id' },
        { title: '更新时间', dataIndex: 'mtime', key: 'mtime', width: 220 },
        { title: '路径', dataIndex: 'path', key: 'path', ellipsis: true }
      ],
      poller: null
    }
  },
  computed: {
    ...mapState({ navTheme: state => state.app.theme }),
    isDarkTheme () { return ['dark', 'realdark'].includes(this.navTheme) },
    bridgeConnected () { return !this.bridgeOffline && this.statusData && this.statusData.ok !== false }
  },
  mounted () {
    this.refreshAll()
  },
  beforeDestroy () {
    this.stopPolling()
  },
  methods: {
    unwrap (res) {
      return res && Object.prototype.hasOwnProperty.call(res, 'data') ? res.data : res
    },
    isSuccess (res) {
      return !res || res.code === undefined || res.code === 1
    },
    async refreshAll () {
      this.refreshing = true
      try {
        await Promise.all([this.loadStatus(), this.loadSessions()])
      } finally {
        this.refreshing = false
      }
    },
    async loadStatus () {
      try {
        const res = await fetchRdagentStatus()
        if (!this.isSuccess(res)) {
          this.bridgeOffline = true
          this.statusData = null
          this.runningJob = null
          this.logText = ''
          this.stopPolling()
          return
        }
        this.bridgeOffline = false
        this.statusData = this.unwrap(res) || {}
        const running = Array.isArray(this.statusData.running_jobs) ? this.statusData.running_jobs : []
        this.runningJob = running.length ? running[0] : null
        this.syncPolling()
        if (this.runningJob) {
          await this.loadLogs(this.runningJob.id)
        } else {
          this.logText = ''
        }
      } catch (error) {
        this.bridgeOffline = true
        this.statusData = null
        this.runningJob = null
        this.logText = ''
        this.stopPolling()
      }
    },
    async loadSessions () {
      this.sessionsLoading = true
      try {
        const res = await fetchRdagentSessions()
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.sessions = this.unwrap(res) || []
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '加载会话失败')
      } finally {
        this.sessionsLoading = false
      }
    },
    async loadLogs (jobId) {
      if (!jobId) return
      try {
        const res = await fetchRdagentJobLogs(jobId, { tail: 200 })
        if (!this.isSuccess(res)) return
        const payload = this.unwrap(res) || {}
        const lines = Array.isArray(payload.lines) ? payload.lines : []
        this.logText = lines.join('\n')
      } catch (error) {
        // 日志轮询失败时不打断主流程
      }
    },
    syncPolling () {
      if (this.runningJob) {
        if (!this.poller) {
          this.poller = createVisibilityPolling(async () => {
            await this.loadStatus()
          }, 3000)
          this.poller.start()
        }
      } else {
        this.stopPolling()
      }
    },
    stopPolling () {
      if (this.poller) {
        this.poller.stop()
        this.poller = null
      }
    },
    async handleStart () {
      this.starting = true
      try {
        const res = await startRdagentJob({
          scenario: this.form.scenario,
          step_n: this.form.step_n
        })
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.$message.success('任务已启动')
        await this.loadStatus()
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '启动失败')
      } finally {
        this.starting = false
      }
    },
    async handleStop () {
      if (!this.runningJob) return
      this.stopping = true
      try {
        const res = await stopRdagentJob(this.runningJob.id)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.$message.success('已发送停止信号')
        await this.loadStatus()
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '停止失败')
      } finally {
        this.stopping = false
      }
    },
    async openUi () {
      try {
        await startRdagentUi()
      } catch (error) {
        // 即使启动接口失败也尝试打开本地 UI
      }
      window.open(UI_URL, '_blank')
    }
  }
}
</script>

<style lang="less" scoped>
.rdagent-page {
  min-height: calc(100vh - 64px);
  padding: 20px;
  background: #f4f6f8;
  color: #1f2933;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}
.kicker {
  color: #722ed1;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}
.page-header h1 {
  margin: 3px 0 4px;
  font-size: 28px;
}
.page-header p {
  margin: 0;
  color: #667085;
}
.header-actions {
  display: flex;
  gap: 8px;
}
.bridge-alert,
.host-note {
  margin-bottom: 14px;
}
.workspace-card {
  margin-bottom: 14px;
  padding: 18px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
}
.section-title {
  margin: 0 0 14px;
  font-size: 16px;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.section-head .section-title {
  margin-bottom: 0;
}
.job-form {
  margin-bottom: 14px;
}
.status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.status-meta {
  color: #667085;
  font-size: 13px;
}
.log-panel {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}
.log-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #f7f8fa;
  border-bottom: 1px solid #e5e7eb;
}
.log-pre {
  max-height: 360px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  background: #0b1020;
  color: #d6deeb;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.theme-dark {
  background: #0b0b0b;
  color: #f5f5f5;
}
.theme-dark h1 {
  color: #f5f5f5;
}
.theme-dark .page-header p,
.theme-dark .status-meta {
  color: #a7a7a7;
}
.theme-dark .workspace-card {
  border-color: #2b2b2b;
  background: #151515;
}
.theme-dark .log-panel {
  border-color: #303030;
}
.theme-dark .log-header {
  background: #1d1d1d;
  border-color: #303030;
}
@media (max-width: 760px) {
  .rdagent-page {
    padding: 14px;
  }
  .page-header {
    flex-direction: column;
  }
  .job-form {
    display: block;
  }
}
</style>
