<template>
  <section class="workspace-card session-detail" :class="{ 'theme-dark': isDarkTheme }">
    <div class="section-head">
      <div>
        <h2 class="section-title">会话详情</h2>
        <p class="detail-meta">
          {{ sessionId }}
          <template v-if="detail && detail.scenario"> · {{ detail.scenario }}</template>
        </p>
      </div>
      <div class="detail-actions">
        <a-button size="small" icon="download" :loading="csvLoading" @click="downloadCsv">
          下载指标 CSV
        </a-button>
        <a-button size="small" type="primary" icon="import" @click="$emit('import', sessionId)">
          导入 External Alpha
        </a-button>
        <a-button size="small" icon="close" @click="$emit('close')">关闭</a-button>
      </div>
    </div>

    <a-spin :spinning="loading">
      <a-alert
        v-if="error"
        type="error"
        show-icon
        :message="error"
        style="margin-bottom: 12px"
      />

      <template v-if="detail">
        <div class="block">
          <h3 class="block-title">总览</h3>
          <a-table
            size="small"
            row-key="label"
            :columns="metricColumns"
            :data-source="metricRows"
            :pagination="false"
            :scroll="{ x: 900 }"
          />
          <div ref="metricsChart" class="chart-box" />
          <div class="hyp-head">
            <strong>假设列表</strong>
            <a-switch
              size="small"
              v-model="showTrueOnly"
              checked-children="只看成功"
              un-checked-children="全部"
            />
          </div>
          <a-empty v-if="!hypothesisRows.length" description="尚无研究循环" />
          <a-list
            v-else
            size="small"
            bordered
            :data-source="hypothesisRows"
          >
            <a-list-item slot="renderItem" slot-scope="item">
              <div class="hyp-item">
                <div class="hyp-title">
                  <a-tag :color="decisionColor(item.decision)">Loop_{{ item.loop_index }}</a-tag>
                  <span>{{ item.decisionLabel }}</span>
                </div>
                <div class="hyp-text">{{ item.hypothesis || '—' }}</div>
              </div>
            </a-list-item>
          </a-list>
        </div>

        <div class="block">
          <h3 class="block-title">研发循环</h3>
          <a-empty v-if="!loops.length" description="尚无研究循环" />
          <template v-else>
            <a-form layout="inline" class="loop-form">
              <a-form-item label="Loop">
                <a-select v-model="activeLoop" style="width: 160px" @change="onLoopChange">
                  <a-select-option v-for="loop in loops" :key="loop.loop_index" :value="loop.loop_index">
                    Loop_{{ loop.loop_index }}
                  </a-select-option>
                </a-select>
              </a-form-item>
            </a-form>

            <a-tabs v-model="loopTab" @change="onLoopTabChange">
              <a-tab-pane key="research" tab="研究">
                <template v-if="currentLoop">
                  <div class="kv">
                    <label>假设</label>
                    <pre class="text-block">{{ (currentLoop.hypothesis && currentLoop.hypothesis.hypothesis) || '—' }}</pre>
                  </div>
                  <div class="kv">
                    <label>理由</label>
                    <pre class="text-block">{{ (currentLoop.hypothesis && currentLoop.hypothesis.reason) || '—' }}</pre>
                  </div>
                </template>
              </a-tab-pane>

              <a-tab-pane key="dev" tab="开发">
                <a-empty v-if="!currentFactors.length" description="本轮暂无因子" />
                <a-collapse
                  v-else
                  accordion
                  :active-key="activeFactorKey"
                  @change="onFactorExpand"
                >
                  <a-collapse-panel
                    v-for="(factor, idx) in currentFactors"
                    :key="String(idx)"
                    :header="factorHeader(factor)"
                  >
                    <div class="kv">
                      <label>描述</label>
                      <pre class="text-block">{{ factor.description || '—' }}</pre>
                    </div>
                    <div class="kv">
                      <label>公式</label>
                      <pre class="text-block">{{ factor.formulation || '—' }}</pre>
                    </div>
                    <div class="kv">
                      <label>编码反馈</label>
                      <pre class="text-block">{{ factor.final_feedback || '—' }}</pre>
                    </div>
                    <a-spin :spinning="codeLoading">
                      <div class="kv">
                        <label>factor.py</label>
                        <pre class="code-block">{{ factor.code || (codeLoaded ? '（无代码）' : '展开后加载…') }}</pre>
                      </div>
                    </a-spin>
                  </a-collapse-panel>
                </a-collapse>
              </a-tab-pane>

              <a-tab-pane key="feedback" tab="反馈">
                <a-spin :spinning="equityLoading">
                  <template v-if="currentLoop">
                    <a-table
                      size="small"
                      row-key="label"
                      :columns="compareColumns"
                      :data-source="compareRows"
                      :pagination="false"
                      style="margin-bottom: 12px"
                    />
                    <div class="kv" v-for="field in feedbackFields" :key="field.key">
                      <label>{{ field.label }}</label>
                      <pre class="text-block">{{ feedbackText(field.key) }}</pre>
                    </div>
                    <div ref="equityChart" class="chart-box" />
                    <a-empty
                      v-if="!equityLoading && !hasEquity"
                      description="暂无净值曲线"
                      style="margin-top: 8px"
                    />
                  </template>
                </a-spin>
              </a-tab-pane>

              <a-tab-pane key="evolution" tab="编码进化">
                <a-spin :spinning="evolutionLoading">
                  <a-empty v-if="!evolutionGroups.length" description="暂无编码进化记录" />
                  <div v-for="group in evolutionGroups" :key="group.name" class="evo-group">
                    <h4>{{ group.name }} {{ group.successMark }}</h4>
                    <a-timeline>
                      <a-timeline-item
                        v-for="step in group.steps"
                        :key="`${group.name}-${step.evo_loop}`"
                        :color="step.decision === false ? 'red' : (step.decision ? 'green' : 'gray')"
                      >
                        <div class="evo-step">
                          <strong>evo_loop_{{ step.evo_loop }}</strong>
                          <a-tag :color="decisionColor(step.decision)">
                            {{ formatDecision(step.decision) }}
                          </a-tag>
                        </div>
                        <pre class="text-block">{{ step.feedback || '—' }}</pre>
                        <a-collapse v-if="step.code || step.prevCode">
                          <a-collapse-panel key="code" :header="`evo_loop_${step.evo_loop} 代码对比`">
                            <div class="evo-code-compare">
                              <div class="evo-code-pane">
                                <label>上一轮代码</label>
                                <pre class="code-block">{{ step.prevCode || '（无上一轮）' }}</pre>
                              </div>
                              <div class="evo-code-pane">
                                <label>本轮代码</label>
                                <pre class="code-block">{{ step.code || '（无代码）' }}</pre>
                              </div>
                            </div>
                          </a-collapse-panel>
                        </a-collapse>
                      </a-timeline-item>
                    </a-timeline>
                  </div>
                </a-spin>
              </a-tab-pane>
            </a-tabs>
          </template>
        </div>
      </template>
    </a-spin>
  </section>
</template>

<script>
import { mapState } from 'vuex'
import * as echarts from 'echarts'
import { fetchSessionDetail, downloadSessionMetricsCsv } from '@/api/rdagent'

const METRIC_KEYS = [
  'ic',
  'icir',
  'rank_ic',
  'rank_icir',
  'annualized_return',
  'max_drawdown',
  'information_ratio'
]

export default {
  name: 'SessionDetail',
  props: {
    sessionId: { type: String, required: true }
  },
  data () {
    return {
      detail: null,
      loading: false,
      error: '',
      showTrueOnly: false,
      activeLoop: 0,
      loopTab: 'research',
      activeFactorKey: undefined,
      csvLoading: false,
      codeLoading: false,
      equityLoading: false,
      evolutionLoading: false,
      codeLoaded: false,
      equityLoaded: false,
      evolutionLoaded: false,
      metricsChart: null,
      equityChart: null,
      feedbackFields: [
        { key: 'decision', label: '决策' },
        { key: 'observations', label: '观察' },
        { key: 'hypothesis_evaluation', label: '评估' },
        { key: 'reason', label: '理由' },
        { key: 'new_hypothesis', label: '新假设' },
        { key: 'exception', label: '异常' }
      ],
      metricColumns: [
        { title: '标签', dataIndex: 'label', key: 'label', width: 120, fixed: 'left' },
        { title: '决策', dataIndex: 'decisionLabel', key: 'decision', width: 90 },
        { title: 'IC', dataIndex: 'ic', key: 'ic', customRender: v => this.fmt(v) },
        { title: 'ICIR', dataIndex: 'icir', key: 'icir', customRender: v => this.fmt(v) },
        { title: 'Rank IC', dataIndex: 'rank_ic', key: 'rank_ic', customRender: v => this.fmt(v) },
        { title: 'Rank ICIR', dataIndex: 'rank_icir', key: 'rank_icir', customRender: v => this.fmt(v) },
        { title: '年化收益', dataIndex: 'annualized_return', key: 'annualized_return', customRender: v => this.fmt(v) },
        { title: '最大回撤', dataIndex: 'max_drawdown', key: 'max_drawdown', customRender: v => this.fmt(v) },
        { title: 'IR', dataIndex: 'information_ratio', key: 'information_ratio', customRender: v => this.fmt(v) }
      ],
      compareColumns: [
        { title: '', dataIndex: 'label', key: 'label', width: 100 },
        { title: 'IC', dataIndex: 'ic', key: 'ic', customRender: v => this.fmt(v) },
        { title: '年化收益', dataIndex: 'annualized_return', key: 'annualized_return', customRender: v => this.fmt(v) },
        { title: '最大回撤', dataIndex: 'max_drawdown', key: 'max_drawdown', customRender: v => this.fmt(v) },
        { title: 'ICIR', dataIndex: 'icir', key: 'icir', customRender: v => this.fmt(v) },
        { title: 'Rank IC', dataIndex: 'rank_ic', key: 'rank_ic', customRender: v => this.fmt(v) }
      ]
    }
  },
  computed: {
    ...mapState({ navTheme: state => state.app.theme }),
    isDarkTheme () { return ['dark', 'realdark'].includes(this.navTheme) },
    loops () {
      return (this.detail && Array.isArray(this.detail.loops)) ? this.detail.loops : []
    },
    currentLoop () {
      return this.loops.find(l => l.loop_index === this.activeLoop) || null
    },
    currentFactors () {
      return (this.currentLoop && Array.isArray(this.currentLoop.factors)) ? this.currentLoop.factors : []
    },
    metricRows () {
      const series = (this.detail && this.detail.metric_series) || []
      return series.map(row => ({
        ...row,
        label: row.label === 'Alpha Base' ? '基线' : row.label,
        decisionLabel: row.loop_index == null && row.label === 'Alpha Base'
          ? '—'
          : this.formatDecision(row.decision)
      }))
    },
    hypothesisRows () {
      return this.loops
        .map(loop => {
          const decision = loop.feedback && loop.feedback.decision
          return {
            loop_index: loop.loop_index,
            decision,
            decisionLabel: this.formatDecision(decision),
            hypothesis: loop.hypothesis && (loop.hypothesis.hypothesis || loop.hypothesis.error)
          }
        })
        .filter(row => !this.showTrueOnly || row.decision === true)
    },
    compareRows () {
      if (!this.currentLoop) return []
      const baseline = (this.detail && this.detail.baseline) || {}
      const metrics = this.currentLoop.metrics || {}
      return [
        { label: '基线', ...this.pickMetrics(baseline) },
        { label: `Loop_${this.activeLoop}`, ...this.pickMetrics(metrics) }
      ]
    },
    hasEquity () {
      const curve = this.currentLoop && this.currentLoop.equity_curve
      return Array.isArray(curve) && curve.length > 0
    },
    evolutionGroups () {
      return this.currentFactors
        .map(factor => {
          const raw = Array.isArray(factor.evolution) ? factor.evolution : []
          const steps = raw.map((step, idx) => {
            const prev = idx > 0 ? raw[idx - 1] : null
            return {
              ...step,
              prevCode: prev && prev.code ? prev.code : null
            }
          })
          return {
            name: factor.name,
            successMark: this.successMark(factor.coding_success),
            steps
          }
        })
        .filter(group => group.steps.length)
    }
  },
  watch: {
    sessionId: {
      immediate: true,
      handler (id) {
        if (id) this.resetAndLoad()
      }
    },
    metricRows () {
      this.$nextTick(this.renderMetricsChart)
    },
    isDarkTheme () {
      this.$nextTick(() => {
        this.renderMetricsChart()
        this.renderEquityChart()
      })
    }
  },
  mounted () {
    window.addEventListener('resize', this.resizeCharts)
  },
  beforeDestroy () {
    window.removeEventListener('resize', this.resizeCharts)
    if (this.metricsChart) this.metricsChart.dispose()
    if (this.equityChart) this.equityChart.dispose()
  },
  methods: {
    unwrap (res) {
      return res && Object.prototype.hasOwnProperty.call(res, 'data') ? res.data : res
    },
    isSuccess (res) {
      return !res || res.code === undefined || res.code === 1
    },
    fmt (value) {
      if (value == null || value === '') return '—'
      const n = Number(value)
      return Number.isFinite(n) ? n.toFixed(4) : '—'
    },
    formatDecision (value) {
      if (value === true) return '成功'
      if (value === false) return '失败'
      return '—'
    },
    decisionColor (value) {
      if (value === true) return 'green'
      if (value === false) return 'red'
      return 'default'
    },
    successMark (value) {
      if (value === true) return '✔️'
      if (value === false) return '❌'
      return ''
    },
    factorHeader (factor) {
      return `${factor.name || 'factor'} ${this.successMark(factor.coding_success)}`
    },
    pickMetrics (src) {
      const out = {}
      METRIC_KEYS.forEach(key => { out[key] = src && src[key] != null ? src[key] : null })
      return out
    },
    feedbackText (key) {
      const fb = (this.currentLoop && this.currentLoop.feedback) || {}
      if (key === 'decision') return this.formatDecision(fb.decision)
      const val = fb[key]
      if (val == null || val === '') return '—'
      return String(val)
    },
    resetAndLoad () {
      this.detail = null
      this.error = ''
      this.activeLoop = 0
      this.loopTab = 'research'
      this.activeFactorKey = undefined
      this.codeLoaded = false
      this.equityLoaded = false
      this.evolutionLoaded = false
      this.load('summary,loops,factors')
    },
    async load (include, { silent } = {}) {
      if (!this.sessionId) return null
      if (!silent) this.loading = true
      this.error = ''
      try {
        const res = await fetchSessionDetail(this.sessionId, include)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const payload = this.unwrap(res) || {}
        this.mergeDetail(payload)
        if (this.loops.length && !this.loops.some(l => l.loop_index === this.activeLoop)) {
          this.activeLoop = this.loops[0].loop_index
        }
        this.$nextTick(this.renderMetricsChart)
        return payload
      } catch (error) {
        this.error = error.backendMessage || error.message || '加载会话详情失败'
        this.$message.error(this.error)
        return null
      } finally {
        if (!silent) this.loading = false
      }
    },
    mergeDetail (payload) {
      if (!this.detail) {
        this.detail = payload
        return
      }
      const next = { ...this.detail }
      if (payload.session_id) next.session_id = payload.session_id
      if (payload.scenario != null) next.scenario = payload.scenario
      if (payload.baseline !== undefined) next.baseline = payload.baseline
      if (Array.isArray(payload.metric_series) && payload.metric_series.length) {
        next.metric_series = payload.metric_series
      }
      if (Array.isArray(payload.loops) && payload.loops.length) {
        const byIndex = {}
        ;(next.loops || []).forEach(loop => { byIndex[loop.loop_index] = { ...loop } })
        payload.loops.forEach(loop => {
          const prev = byIndex[loop.loop_index] || {}
          const merged = { ...prev, ...loop }
          if (Array.isArray(loop.factors) && loop.factors.length) {
            const prevFactors = Array.isArray(prev.factors) ? prev.factors : []
            merged.factors = loop.factors.map((factor, idx) => {
              const old = prevFactors[idx] || {}
              return {
                ...old,
                ...factor,
                code: factor.code != null ? factor.code : old.code,
                evolution: factor.evolution != null ? factor.evolution : old.evolution
              }
            })
          } else if (prev.factors) {
            merged.factors = prev.factors
          }
          if (loop.equity_curve == null && prev.equity_curve != null) {
            merged.equity_curve = prev.equity_curve
          }
          byIndex[loop.loop_index] = merged
        })
        next.loops = Object.keys(byIndex)
          .map(k => byIndex[k])
          .sort((a, b) => a.loop_index - b.loop_index)
      }
      this.detail = next
    },
    onLoopChange () {
      this.activeFactorKey = undefined
      if (this.loopTab === 'feedback') this.refreshEquityChart()
      if (this.loopTab === 'evolution') this.ensureEvolution()
    },
    onLoopTabChange (key) {
      this.loopTab = key
      if (key === 'feedback') this.refreshEquityChart()
      if (key === 'evolution') this.ensureEvolution()
    },
    async refreshEquityChart () {
      await this.ensureEquity()
      this.$nextTick(() => {
        this.renderEquityChart()
        this.resizeCharts()
      })
    },
    async onFactorExpand (key) {
      this.activeFactorKey = key
      if (key == null || key === '') return
      await this.ensureCode()
    },
    async ensureCode () {
      if (this.codeLoaded || this.codeLoading) return
      this.codeLoading = true
      try {
        await this.load('loops,factors,code', { silent: true })
        this.codeLoaded = true
      } finally {
        this.codeLoading = false
      }
    },
    async ensureEquity () {
      if (this.equityLoaded || this.equityLoading) return
      this.equityLoading = true
      try {
        await this.load('loops,equity', { silent: true })
        this.equityLoaded = true
      } finally {
        this.equityLoading = false
      }
    },
    async ensureEvolution () {
      if (this.evolutionLoaded || this.evolutionLoading) return
      this.evolutionLoading = true
      try {
        await this.load('loops,factors,evolution', { silent: true })
        this.evolutionLoaded = true
      } finally {
        this.evolutionLoading = false
      }
    },
    renderMetricsChart () {
      const el = this.$refs.metricsChart
      if (!el) return
      const rows = this.metricRows
      if (!rows.length) {
        if (this.metricsChart) {
          this.metricsChart.clear()
        }
        return
      }
      if (!this.metricsChart) this.metricsChart = echarts.init(el)
      const text = this.isDarkTheme ? '#a7a7a7' : '#667085'
      const grid = this.isDarkTheme ? '#303030' : '#e5e7eb'
      const labels = rows.map(r => r.label)
      this.metricsChart.setOption({
        animationDuration: 240,
        tooltip: { trigger: 'axis' },
        legend: { data: ['IC', '年化收益', '最大回撤'], textStyle: { color: text } },
        grid: { left: 48, right: 24, top: 40, bottom: 32 },
        xAxis: {
          type: 'category',
          data: labels,
          axisLabel: { color: text },
          axisLine: { lineStyle: { color: grid } }
        },
        yAxis: {
          type: 'value',
          scale: true,
          axisLabel: { color: text },
          splitLine: { lineStyle: { color: grid, type: 'dashed' } }
        },
        series: [
          { name: 'IC', type: 'line', data: rows.map(r => r.ic), showSymbol: true },
          { name: '年化收益', type: 'line', data: rows.map(r => r.annualized_return), showSymbol: true },
          { name: '最大回撤', type: 'line', data: rows.map(r => r.max_drawdown), showSymbol: true }
        ]
      }, true)
    },
    renderEquityChart () {
      const el = this.$refs.equityChart
      if (!el) return
      const curve = (this.currentLoop && this.currentLoop.equity_curve) || []
      if (!Array.isArray(curve) || !curve.length) {
        if (this.equityChart) this.equityChart.clear()
        return
      }
      if (!this.equityChart) this.equityChart = echarts.init(el)
      const text = this.isDarkTheme ? '#a7a7a7' : '#667085'
      const grid = this.isDarkTheme ? '#303030' : '#e5e7eb'
      this.equityChart.setOption({
        animationDuration: 240,
        tooltip: { trigger: 'axis' },
        legend: { data: ['账户净值', '基准'], textStyle: { color: text } },
        grid: { left: 48, right: 24, top: 40, bottom: 32 },
        xAxis: {
          type: 'category',
          data: curve.map(p => p.date),
          axisLabel: { color: text, hideOverlap: true },
          axisLine: { lineStyle: { color: grid } }
        },
        yAxis: {
          type: 'value',
          scale: true,
          axisLabel: { color: text },
          splitLine: { lineStyle: { color: grid, type: 'dashed' } }
        },
        series: [
          { name: '账户净值', type: 'line', data: curve.map(p => p.account), showSymbol: false },
          { name: '基准', type: 'line', data: curve.map(p => p.bench), showSymbol: false }
        ]
      }, true)
      this.$nextTick(() => {
        if (this.equityChart) this.equityChart.resize()
      })
    },
    resizeCharts () {
      if (this.metricsChart) this.metricsChart.resize()
      if (this.equityChart) this.equityChart.resize()
    },
    async downloadCsv () {
      if (!this.sessionId) return
      this.csvLoading = true
      try {
        const blob = await downloadSessionMetricsCsv(this.sessionId)
        const file = blob instanceof Blob ? blob : new Blob([blob], { type: 'text/csv;charset=utf-8;' })
        if (file.type && file.type.includes('application/json')) {
          const text = await file.text()
          let msg = '下载失败'
          try {
            const json = JSON.parse(text)
            msg = json.msg || msg
          } catch (e) { /* ignore */ }
          throw new Error(msg)
        }
        const url = window.URL.createObjectURL(file)
        const link = document.createElement('a')
        link.href = url
        link.download = `session_${this.sessionId}_metrics.csv`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
        this.$message.success('指标 CSV 已下载')
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '下载 CSV 失败')
      } finally {
        this.csvLoading = false
      }
    }
  }
}
</script>

<style lang="less" scoped>
.session-detail {
  margin-bottom: 14px;
}
.workspace-card {
  padding: 18px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
}
.section-title {
  margin: 0;
  font-size: 16px;
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.detail-meta {
  margin: 4px 0 0;
  color: #667085;
  font-size: 13px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.block {
  margin-top: 8px;
}
.block + .block {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}
.block-title {
  margin: 0 0 12px;
  font-size: 14px;
}
.chart-box {
  width: 100%;
  height: 280px;
  margin: 12px 0 16px;
}
.hyp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.hyp-item {
  width: 100%;
}
.hyp-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.hyp-text {
  color: #364152;
  white-space: pre-wrap;
  word-break: break-word;
}
.loop-form {
  margin-bottom: 8px;
}
.kv {
  margin-bottom: 12px;
}
.kv label {
  display: block;
  margin-bottom: 4px;
  color: #667085;
  font-size: 12px;
  font-weight: 600;
}
.text-block,
.code-block {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #f7f8fa;
  color: #1f2933;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 280px;
  overflow: auto;
}
.code-block {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: #0b1020;
  color: #d6deeb;
}
.evo-group {
  margin-bottom: 16px;
}
.evo-group h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.evo-step {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.evo-code-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.evo-code-pane label {
  display: block;
  margin-bottom: 4px;
  color: #667085;
  font-size: 12px;
  font-weight: 600;
}
.evo-code-pane .code-block {
  max-height: 360px;
}
@media (max-width: 960px) {
  .evo-code-compare {
    grid-template-columns: 1fr;
  }
}
.theme-dark.workspace-card {
  border-color: #2b2b2b;
  background: #151515;
}
.theme-dark .detail-meta,
.theme-dark .kv label,
.theme-dark .evo-code-pane label,
.theme-dark .hyp-text {
  color: #a7a7a7;
}
.theme-dark .block + .block {
  border-color: #303030;
}
.theme-dark .text-block {
  background: #1d1d1d;
  color: #f5f5f5;
}
@media (max-width: 760px) {
  .section-head {
    flex-direction: column;
  }
}
</style>
