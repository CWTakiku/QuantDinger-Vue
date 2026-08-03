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
        <a-form-item label="数据源">
          <a-select
            v-model="form.data_source"
            :disabled="!!runningJob || bridgeOffline"
            style="width: 280px"
            :loading="dataSourcesLoading"
            @change="onDataSourceChange"
          >
            <a-select-option
              v-for="item in dataSourceOptions"
              :key="item.id"
              :value="item.id"
              :disabled="item.exists === false"
            >
              {{ item.label }}{{ item.calendar_end ? ` · 至 ${item.calendar_end}` : '' }}{{ item.active ? ' · 当前' : '' }}
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="开始日期">
          <a-date-picker
            v-model="form.start_date"
            value-format="YYYY-MM-DD"
            :disabled="!!runningJob || bridgeOffline"
            placeholder="可选"
            style="width: 140px"
            @change="onDatesTouched"
          />
        </a-form-item>
        <a-form-item label="结束日期">
          <a-date-picker
            v-model="form.end_date"
            value-format="YYYY-MM-DD"
            :disabled="!!runningJob || bridgeOffline"
            placeholder="可选"
            style="width: 140px"
            @change="onDatesTouched"
          />
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
      <p class="date-hint">
        日期留空则使用 RD 模板默认区间；填写后按 60% / 15% / 25% 自动切分训练、验证、回测（总跨度至少 3 年）。
      </p>

      <div v-if="statusData" class="status-row">
        <a-tag :color="bridgeConnected ? 'green' : 'red'">
          Bridge {{ bridgeConnected ? '已连接' : '未连接' }}
        </a-tag>
        <a-tag v-if="statusData.workspace_exists === false" color="orange">工作区不存在</a-tag>
        <a-tag v-if="llmSyncTag.color" :color="llmSyncTag.color">{{ llmSyncTag.text }}</a-tag>
        <template v-if="runningJob">
          <a-tag color="blue">运行中</a-tag>
          <span class="status-meta">任务 {{ runningJob.id }} · {{ runningJob.scenario || form.scenario }} · step {{ runningJob.step_n || form.step_n }}</span>
        </template>
        <template v-else-if="lastJob">
          <a-tag :color="lastJobTag.color">{{ lastJobTag.text }}</a-tag>
          <span class="status-meta">
            最近任务 {{ lastJob.id }}
            · {{ lastJob.scenario || '-' }}
            · step {{ lastJob.step_n != null ? lastJob.step_n : '-' }}
            · 退出码 {{ lastJob.exit_code != null ? lastJob.exit_code : '-' }}
          </span>
        </template>
        <span v-else class="status-meta">尚无任务记录</span>
      </div>

      <a-alert
        v-if="lastJobBanner.show"
        :type="lastJobBanner.type"
        show-icon
        :message="lastJobBanner.message"
        :description="lastJobBanner.description"
        style="margin-top: 12px"
      />

      <div class="log-panel">
        <div class="log-header">
          <strong>日志尾部</strong>
          <a-tag v-if="runningJob" color="processing">每 3 秒刷新</a-tag>
          <a-button
            v-if="logJobId"
            size="small"
            type="link"
            @click="loadLogs(logJobId)"
          >
            刷新日志
          </a-button>
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
        :row-selection="sessionRowSelection"
      >
        <template slot="sessionAction" slot-scope="text, record">
          <a-button
            type="link"
            size="small"
            @click="openSessionDetail(record)"
          >
            查看详情
          </a-button>
          <a-button
            type="danger"
            size="small"
            ghost
            icon="delete"
            :disabled="bridgeOffline || deletingSessionId === record.id"
            :loading="deletingSessionId === record.id"
            @click="confirmDeleteSession(record)"
          >
            删除
          </a-button>
        </template>
      </a-table>
    </section>

    <session-detail
      v-if="selectedDetailSessionId"
      :session-id="selectedDetailSessionId"
      @import="fillImportFromDetail"
      @close="selectedDetailSessionId = ''"
    />

    <section class="workspace-card import-card">
      <h2 class="section-title">导入分数</h2>
      <p class="import-hint">从所选会话导出预测分数并写入 External Alpha 库，供策略回测与实盘使用。</p>
      <a-form layout="vertical" class="import-form">
        <a-row :gutter="16">
          <a-col :xs="24" :md="12">
            <a-form-item label="会话 ID">
              <a-select
                v-model="importForm.session_id"
                show-search
                allow-clear
                placeholder="选择或搜索会话"
                :disabled="bridgeOffline"
                option-filter-prop="children"
              >
                <a-select-option v-for="item in sessions" :key="item.id" :value="item.id">
                  {{ item.id }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="6">
            <a-form-item label="source">
              <a-input v-model="importForm.source" :disabled="bridgeOffline" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="6">
            <a-form-item label="version">
              <a-input
                v-model="importForm.version"
                placeholder="留空则 session_&lt;id&gt;"
                :disabled="bridgeOffline"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="6">
            <a-form-item label="universe">
              <a-input v-model="importForm.universe" :disabled="bridgeOffline" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item>
          <a-button
            type="primary"
            icon="import"
            :loading="importing"
            :disabled="!importForm.session_id || bridgeOffline"
            @click="handleImport"
          >
            导入到 External Alpha
          </a-button>
        </a-form-item>
      </a-form>

      <a-alert
        v-if="importResult"
        type="success"
        show-icon
        class="import-result"
      >
        <template slot="message">
          已入库 {{ importResult.inserted != null ? importResult.inserted : importResult.parsed_rows }} 行
          · source={{ importResult.source }} · version={{ importResult.version }}
        </template>
        <template slot="description">
          可在
          <router-link to="/strategy-center">策略中心</router-link>
          创建或回测策略时引用上述 source/version 作为外部 Alpha 信号。
        </template>
      </a-alert>
    </section>
  </div>
</template>

<script>
import { mapState } from 'vuex'
import {
  fetchRdagentStatus,
  fetchRdagentJobLogs,
  fetchRdagentSessions,
  deleteRdagentSession,
  importFromSession,
  fetchRdagentDataSources,
  startRdagentJob,
  startRdagentUi,
  stopRdagentJob
} from '@/api/rdagent'
import { createVisibilityPolling } from '@/utils/visibilityPolling'
import SessionDetail from './SessionDetail.vue'

const UI_URL = 'http://127.0.0.1:19899'

export default {
  name: 'RdAgentLab',
  components: { SessionDetail },
  data () {
    return {
      bridgeOffline: false,
      refreshing: false,
      starting: false,
      stopping: false,
      sessionsLoading: false,
      deletingSessionId: '',
      selectedDetailSessionId: '',
      dataSourcesLoading: false,
      importing: false,
      importResult: null,
      statusData: null,
      runningJob: null,
      lastJob: null,
      previousRunningJobId: null,
      logText: '',
      logJobId: null,
      sessions: [],
      dataSources: [],
      datesTouched: false,
      form: {
        scenario: 'fin_factor',
        data_source: 'quantmind',
        start_date: undefined,
        end_date: undefined,
        step_n: 1
      },
      importForm: {
        session_id: undefined,
        source: 'rdagent',
        version: '',
        universe: 'csi300'
      },
      selectedSessionKeys: [],
      scenarios: [
        { value: 'fin_factor', label: 'fin_factor（因子挖掘）' },
        { value: 'fin_quant', label: 'fin_quant（量化研究）' }
      ],
      sessionColumns: [
        { title: '会话 ID', dataIndex: 'id', key: 'id' },
        { title: '更新时间', dataIndex: 'mtime', key: 'mtime', width: 220 },
        { title: '路径', dataIndex: 'path', key: 'path', ellipsis: true },
        {
          title: '操作',
          key: 'action',
          width: 180,
          scopedSlots: { customRender: 'sessionAction' }
        }
      ],
      poller: null
    }
  },
  computed: {
    ...mapState({ navTheme: state => state.app.theme }),
    isDarkTheme () { return ['dark', 'realdark'].includes(this.navTheme) },
    bridgeConnected () { return !this.bridgeOffline && this.statusData && this.statusData.ok !== false },
    dataSourceOptions () {
      if (this.dataSources.length) return this.dataSources
      return [
        { id: 'default', label: '官方 cn_data（约至 2020）', exists: true },
        { id: 'quantmind', label: 'QuantMInd（至 2026-05）', exists: true }
      ]
    },
    llmSyncTag () {
      const sync = (this.statusData && this.statusData.llm_sync) || {}
      if (!this.bridgeConnected) return {}
      if (sync.applied && sync.chat_model) {
        return { color: 'green', text: `LLM 已同步 QD · ${sync.provider || ''} · ${sync.chat_model}` }
      }
      if (sync.enabled && sync.error) {
        return { color: 'orange', text: `LLM 同步失败 · ${sync.error}` }
      }
      if (sync.enabled === false) {
        return { color: 'default', text: 'LLM 使用 workspace .env' }
      }
      return { color: 'default', text: 'LLM 同步状态未知' }
    },
    lastJobTag () {
      const status = String((this.lastJob && this.lastJob.status) || '').toLowerCase()
      if (status === 'succeeded' || status === 'completed') return { color: 'green', text: '最近任务成功' }
      if (status === 'failed') return { color: 'red', text: '最近任务失败' }
      if (status === 'stopped') return { color: 'orange', text: '最近任务已停止' }
      return { color: 'default', text: status ? `最近任务 ${status}` : '最近任务' }
    },
    lastJobBanner () {
      if (this.runningJob || !this.lastJob) return { show: false }
      const status = String(this.lastJob.status || '').toLowerCase()
      const id = this.lastJob.id || '-'
      const sessionHint = this.newestSessionId
      if (status === 'succeeded' || status === 'completed') {
        return {
          show: true,
          type: this.logLooksRateLimited ? 'warning' : 'success',
          message: this.logLooksRateLimited
            ? `任务 ${id} 进程已结束（退出码 ${this.lastJob.exit_code}），但日志出现 LLM 额度/限流错误`
            : `任务 ${id} 已成功结束`,
          description: sessionHint
            ? `会话 ${sessionHint}。请打开 RD UI（19899）核对因子/回测；若要进策略，在下方导入分数。`
            : '请刷新历史会话，并打开 RD UI（19899）核对产出；确认有分数后再导入。'
        }
      }
      if (status === 'failed') {
        return {
          show: true,
          type: 'error',
          message: `任务 ${id} 失败（退出码 ${this.lastJob.exit_code != null ? this.lastJob.exit_code : '-'}）`,
          description: this.logLooksRateLimited
            ? '日志含余额不足/429，请先给 QD 所用 LLM 充值或换模型后再启动。'
            : '请查看下方日志尾部定位错误。'
        }
      }
      if (status === 'stopped') {
        return {
          show: true,
          type: 'warning',
          message: `任务 ${id} 已手动停止`,
          description: '可重新启动；未完成会话通常没有可导入分数。'
        }
      }
      return { show: false }
    },
    newestSessionId () {
      return this.sessions && this.sessions.length ? this.sessions[0].id : ''
    },
    logLooksRateLimited () {
      const text = this.logText || ''
      return /429|RateLimit|余额不足|无可用资源包/.test(text)
    },
    sessionRowSelection () {
      return {
        type: 'radio',
        selectedRowKeys: this.selectedSessionKeys,
        onChange: (keys) => {
          this.selectedSessionKeys = keys
          this.importForm.session_id = keys.length ? keys[0] : undefined
        }
      }
    }
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
        await Promise.all([this.loadStatus(), this.loadSessions(), this.loadDataSources()])
      } finally {
        this.refreshing = false
      }
    },
    async loadDataSources () {
      this.dataSourcesLoading = true
      try {
        const res = await fetchRdagentDataSources()
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const list = this.unwrap(res) || []
        this.dataSources = Array.isArray(list) ? list : []
        const active = this.dataSources.find(d => d.active && d.exists !== false)
        const preferred = this.dataSources.find(d => d.id === 'quantmind' && d.exists !== false)
        if (active) {
          this.form.data_source = active.id
        } else if (preferred) {
          this.form.data_source = preferred.id
        } else if (this.dataSources.length && !this.dataSources.some(d => d.id === this.form.data_source && d.exists !== false)) {
          const firstOk = this.dataSources.find(d => d.exists !== false)
          if (firstOk) this.form.data_source = firstOk.id
        }
        this.applyCalendarDefaults(this.form.data_source)
      } catch (error) {
        // keep fallback options
      } finally {
        this.dataSourcesLoading = false
      }
    },
    onDatesTouched () {
      this.datesTouched = true
    },
    onDataSourceChange (id) {
      this.applyCalendarDefaults(id)
    },
    applyCalendarDefaults (dataSourceId) {
      if (this.datesTouched) return
      const item = (this.dataSources || []).find(d => d.id === dataSourceId)
      if (!item) return
      this.form.start_date = item.calendar_start || undefined
      this.form.end_date = item.calendar_end || undefined
    },
    async loadStatus () {
      try {
        const res = await fetchRdagentStatus()
        if (!this.isSuccess(res)) {
          this.bridgeOffline = true
          this.statusData = null
          this.runningJob = null
          this.lastJob = null
          this.logText = ''
          this.stopPolling()
          return
        }
        this.bridgeOffline = false
        this.statusData = this.unwrap(res) || {}
        const running = Array.isArray(this.statusData.running_jobs) ? this.statusData.running_jobs : []
        const nextRunning = running.length ? running[0] : null
        this.lastJob = this.statusData.last_job || null

        // 从运行中变为结束：弹一次明确结果
        if (this.previousRunningJobId && !nextRunning) {
          const done = this.lastJob && this.lastJob.id === this.previousRunningJobId
            ? this.lastJob
            : this.lastJob
          const status = String((done && done.status) || '').toLowerCase()
          if (status === 'succeeded' || status === 'completed') {
            this.$message.success(`挖掘任务已结束：成功（${done.id}）`)
          } else if (status === 'failed') {
            this.$message.error(`挖掘任务已结束：失败（${done && done.id ? done.id : this.previousRunningJobId}）`)
          } else if (status === 'stopped') {
            this.$message.warning(`挖掘任务已停止（${done && done.id ? done.id : this.previousRunningJobId}）`)
          } else {
            this.$message.info('挖掘任务已结束，请查看最近任务状态')
          }
          await this.loadSessions()
        }
        this.previousRunningJobId = nextRunning ? nextRunning.id : null
        this.runningJob = nextRunning
        this.syncPolling()

        const jobForLogs = this.runningJob || this.lastJob
        if (jobForLogs && jobForLogs.id) {
          this.logJobId = jobForLogs.id
          await this.loadLogs(jobForLogs.id)
        }
      } catch (error) {
        this.bridgeOffline = true
        this.statusData = null
        this.runningJob = null
        this.lastJob = null
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
    confirmDeleteSession (record) {
      if (!record || !record.id) return
      this.$confirm({
        title: '删除会话',
        content: `确定删除会话 ${record.id}？目录将从磁盘移除，且不可恢复。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: () => this.deleteSession(record.id)
      })
    },
    async deleteSession (sessionId) {
      this.deletingSessionId = sessionId
      try {
        const res = await deleteRdagentSession(sessionId)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.$message.success(`已删除会话 ${sessionId}`)
        if (this.importForm.session_id === sessionId) {
          this.importForm.session_id = undefined
        }
        if (this.selectedDetailSessionId === sessionId) {
          this.selectedDetailSessionId = ''
        }
        this.selectedSessionKeys = this.selectedSessionKeys.filter(id => id !== sessionId)
        await this.loadSessions()
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '删除会话失败')
        throw error
      } finally {
        this.deletingSessionId = ''
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
        const payload = {
          scenario: this.form.scenario,
          step_n: this.form.step_n,
          data_source: this.form.data_source || 'default'
        }
        if (this.form.start_date) payload.start_date = this.form.start_date
        if (this.form.end_date) payload.end_date = this.form.end_date
        const res = await startRdagentJob(payload)
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
    },
    openSessionDetail (record) {
      if (!record || !record.id) return
      this.selectedDetailSessionId = record.id
      this.selectedSessionKeys = [record.id]
      this.importForm.session_id = record.id
    },
    fillImportFromDetail (sessionId) {
      if (!sessionId) return
      this.importForm.session_id = sessionId
      this.selectedSessionKeys = [sessionId]
      this.$message.success(`已填入导入会话 ${sessionId}`)
    },
    async handleImport () {
      if (!this.importForm.session_id) {
        this.$message.warning('请先选择会话')
        return
      }
      this.importing = true
      this.importResult = null
      try {
        const payload = {
          session_id: this.importForm.session_id,
          source: this.importForm.source || 'rdagent',
          universe: this.importForm.universe || 'csi300'
        }
        if (this.importForm.version && String(this.importForm.version).trim()) {
          payload.version = String(this.importForm.version).trim()
        }
        const res = await importFromSession(payload)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.importResult = this.unwrap(res) || {}
        const inserted = this.importResult.inserted != null
          ? this.importResult.inserted
          : this.importResult.parsed_rows
        this.$message.success(`已导入 ${inserted || 0} 行分数`)
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '导入失败')
      } finally {
        this.importing = false
      }
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
.date-hint {
  margin: 0 0 12px;
  color: #8c8c8c;
  font-size: 12px;
  line-height: 1.5;
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
.import-hint {
  margin: -6px 0 14px;
  color: #667085;
  font-size: 13px;
}
.import-form {
  max-width: 960px;
}
.import-result {
  margin-top: 12px;
}
.theme-dark .import-hint {
  color: #a7a7a7;
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
