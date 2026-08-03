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

          <div class="sota-head">
            <strong>SOTA 因子库</strong>
            <span v-if="sotaModel" class="sota-model-hint">
              当前 SOTA 模型：{{ sotaModel.name || '—' }}
              <template v-if="sotaModel.loop_index != null">（Loop_{{ sotaModel.loop_index }}）</template>
              <template v-if="sotaModel.architecture"> · {{ sotaModel.architecture }}</template>
            </span>
          </div>
          <a-empty v-if="!sotaLibrary.length" description="尚无采纳因子" />
          <a-table
            v-else
            size="small"
            row-key="name"
            :columns="sotaColumns"
            :data-source="sotaLibrary"
            :pagination="false"
            :expand-row-by-click="false"
            @expand="onSotaExpand"
          >
            <template slot="expandedRowRender" slot-scope="record">
              <a-spin :spinning="sotaCodeLoading">
                <div class="kv">
                  <label>factor.py</label>
                  <pre class="code-block">{{ record.code || (sotaCodeLoaded ? '（无代码）' : '展开后加载…') }}</pre>
                </div>
              </a-spin>
            </template>
          </a-table>

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
                  <a-tag v-if="item.kindLabel">{{ item.kindLabel }}</a-tag>
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
                <a-select v-model="activeLoop" style="width: 220px" @change="onLoopChange">
                  <a-select-option v-for="loop in loops" :key="loop.loop_index" :value="loop.loop_index">
                    {{ loopOptionLabel(loop) }}
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
                  <div class="kv" v-if="currentLoop.hypothesis && currentLoop.hypothesis.action">
                    <label>动作</label>
                    <pre class="text-block">{{ kindLabel(currentLoop.hypothesis.action) }}</pre>
                  </div>
                </template>
              </a-tab-pane>

              <a-tab-pane key="dev" :tab="isModelLoop ? '模型' : '开发'">
                <template v-if="isModelLoop">
                  <a-spin :spinning="codeLoading || logsLoading">
                    <a-empty v-if="!currentModels.length" description="本轮暂无模型产物" />
                    <div
                      v-for="(model, idx) in currentModels"
                      :key="`model-${idx}`"
                      class="model-card"
                    >
                      <div class="model-card-head">
                        <strong>{{ model.name || `model_${idx}` }}</strong>
                        <a-tag :color="decisionColor(model.coding_success)">
                          {{ formatDecision(model.coding_success) }}
                        </a-tag>
                      </div>
                      <div class="kv">
                        <label>结构 / Architecture</label>
                        <pre class="text-block">{{ model.architecture || '—' }}</pre>
                      </div>
                      <div class="kv">
                        <label>模型类型</label>
                        <pre class="text-block">{{ model.model_type || '—' }}</pre>
                      </div>
                      <div class="kv">
                        <label>超参数</label>
                        <pre class="text-block">{{ formatJson(model.hyperparameters) }}</pre>
                      </div>
                      <div class="kv">
                        <label>训练超参数</label>
                        <pre class="text-block">{{ formatJson(model.training_hyperparameters) }}</pre>
                      </div>
                      <div class="kv">
                        <label>model.py</label>
                        <pre class="code-block">{{ model.code || (codeLoaded ? '（无代码）' : '加载中…') }}</pre>
                      </div>
                      <div class="kv">
                        <label>训练日志</label>
                        <pre class="code-block">{{ trainingLogText }}</pre>
                      </div>
                      <div class="kv" v-for="fb in modelFeedbackFields" :key="fb.key">
                        <label>{{ fb.label }}</label>
                        <pre class="text-block">{{ modelFeedbackText(model, fb.key) }}</pre>
                      </div>
                    </div>
                  </a-spin>
                </template>
                <template v-else>
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
                </template>
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
                    <div ref="equityChart" class="chart-box chart-box-equity" />
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

              <a-tab-pane key="matrix" tab="因子矩阵">
                <div class="matrix-toolbar">
                  <a-select
                    v-model="matrixLoopIndex"
                    style="width: 240px"
                    :disabled="!canLoadMatrix"
                    @change="onMatrixLoopChange"
                  >
                    <a-select-option
                      v-for="opt in matrixLoopOptions"
                      :key="String(opt.value)"
                      :value="opt.value"
                    >
                      {{ opt.label }}
                    </a-select-option>
                  </a-select>
                  <a-button
                    size="small"
                    icon="reload"
                    :loading="matrixLoading"
                    :disabled="!canLoadMatrix"
                    @click="loadFactorMatrix"
                  >
                    刷新抽样
                  </a-button>
                  <a-button
                    size="small"
                    icon="download"
                    :loading="matrixCsvLoading"
                    :disabled="!canLoadMatrix"
                    @click="downloadMatrixCsv"
                  >
                    下载 CSV
                  </a-button>
                </div>
                <a-spin :spinning="matrixLoading">
                  <a-alert
                    v-if="matrixError"
                    type="warning"
                    show-icon
                    :message="matrixError"
                    style="margin-bottom: 12px"
                  />
                  <template v-if="matrix">
                    <div class="matrix-meta">
                      <div>覆盖区间：{{ matrix.as_of_min || '—' }} ~ {{ matrix.as_of_max || '—' }}</div>
                      <div>
                        交易日约 {{ matrix.n_dates != null ? matrix.n_dates : '—' }} ·
                        标的约 {{ matrix.n_symbols_est != null ? matrix.n_symbols_est : '—' }} ·
                        Loop_{{ matrix.loop_index != null ? matrix.loop_index : '最新' }}
                      </div>
                    </div>
                    <div class="kv">
                      <label>因子列（{{ matrixFactorNames.length }}）</label>
                      <div class="factor-name-list">
                        <a-tag v-for="name in matrixFactorNames" :key="name">{{ name }}</a-tag>
                        <span v-if="!matrixFactorNames.length">—</span>
                      </div>
                    </div>
                    <a-empty v-if="!matrixSampleRows.length" description="暂无抽样数据" />
                    <a-table
                      v-else
                      size="small"
                      row-key="_key"
                      :columns="matrixSampleColumns"
                      :data-source="matrixSampleRows"
                      :pagination="{ pageSize: 20, size: 'small' }"
                      :scroll="{ x: Math.max(640, 120 + matrixFactorNames.length * 110) }"
                    />
                  </template>
                  <a-empty
                    v-else-if="!matrixError && !canLoadMatrix"
                    description="当前会话没有可抽样的因子 Loop（模型轮次无 parquet，请切换矩阵 Loop 或等待因子轮次产出）"
                  />
                  <a-empty v-else-if="!matrixError" description="点击「刷新抽样」加载因子矩阵" />
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
import {
  fetchSessionDetail,
  downloadSessionMetricsCsv,
  fetchFactorMatrix,
  downloadFactorMatrixCsv
} from '@/api/rdagent'

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
      logsLoading: false,
      equityLoading: false,
      evolutionLoading: false,
      codeLoaded: false,
      logsLoaded: false,
      equityLoaded: false,
      evolutionLoaded: false,
      sotaCodeLoading: false,
      sotaCodeLoaded: false,
      matrix: null,
      matrixLoading: false,
      matrixCsvLoading: false,
      matrixError: '',
      matrixLoadedFor: null,
      // 'latest' = omit loop_index → bridge picks latest loop with parquet
      matrixLoopIndex: 'latest',
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
      modelFeedbackFields: [
        { key: 'execution', label: '执行反馈' },
        { key: 'code', label: '代码反馈' },
        { key: 'shape', label: '形态反馈' },
        { key: 'value', label: '数值反馈' },
        { key: 'final', label: '最终反馈' }
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
      ],
      sotaColumns: [
        { title: '因子名', dataIndex: 'name', key: 'name', width: 180 },
        {
          title: '首次采纳',
          dataIndex: 'first_accepted_loop',
          key: 'first_accepted_loop',
          width: 100,
          customRender: v => (v == null ? '—' : `Loop_${v}`)
        },
        {
          title: '最近出现',
          dataIndex: 'last_seen_loop',
          key: 'last_seen_loop',
          width: 100,
          customRender: v => (v == null ? '—' : `Loop_${v}`)
        },
        {
          title: '公式摘要',
          dataIndex: 'formulation',
          key: 'formulation',
          ellipsis: true,
          customRender: v => (v == null || v === '' ? '—' : String(v))
        }
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
    isModelLoop () {
      return !!(this.currentLoop && this.currentLoop.kind === 'model')
    },
    currentArtifacts () {
      if (!this.currentLoop) return []
      if (Array.isArray(this.currentLoop.artifacts) && this.currentLoop.artifacts.length) {
        return this.currentLoop.artifacts
      }
      return Array.isArray(this.currentLoop.factors) ? this.currentLoop.factors : []
    },
    currentFactors () {
      return this.currentArtifacts.filter(item => !item.kind || item.kind === 'factor')
    },
    currentModels () {
      const models = this.currentArtifacts.filter(item => item.kind === 'model')
      if (models.length) return models
      return this.isModelLoop ? this.currentArtifacts : []
    },
    trainingLogText () {
      if (!this.logsLoaded && !this.logsLoading) return '切换至此将加载训练日志…'
      if (this.logsLoading) return '加载中…'
      const log = this.currentLoop && this.currentLoop.training_log
      if (log == null || log === '') return '（无日志）'
      return String(log)
    },
    sotaLibrary () {
      const summary = (this.detail && this.detail.summary) || {}
      const list = (this.detail && this.detail.sota_library) || summary.sota_library
      return Array.isArray(list) ? list : []
    },
    sotaModel () {
      const summary = (this.detail && this.detail.summary) || {}
      return (this.detail && this.detail.sota_model) || summary.sota_model || null
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
            kind: loop.kind,
            kindLabel: this.kindLabel(loop.kind),
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
        { label: '基线 / SOTA', ...this.pickMetrics(baseline) },
        { label: `Loop_${this.activeLoop}`, ...this.pickMetrics(metrics) }
      ]
    },
    hasEquity () {
      const curve = this.currentLoop && this.currentLoop.equity_curve
      return Array.isArray(curve) && curve.length > 0
    },
    evolutionGroups () {
      return this.currentArtifacts
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
    },
    factorLoops () {
      return this.loops.filter(loop => !loop.kind || loop.kind === 'factor')
    },
    exportableLoops () {
      const list = (this.detail && this.detail.exportable_loops) || []
      return Array.isArray(list) ? list : []
    },
    matrixLoopOptions () {
      const byIndex = new Map()
      this.factorLoops.forEach(loop => {
        byIndex.set(loop.loop_index, {
          value: loop.loop_index,
          label: this.loopOptionLabel(loop)
        })
      })
      this.exportableLoops.forEach(item => {
        const idx = item && item.loop_index
        if (idx == null || byIndex.has(idx)) return
        const loop = this.loops.find(l => l.loop_index === idx)
        byIndex.set(idx, {
          value: idx,
          label: loop ? this.loopOptionLabel(loop) : `Loop_${idx}`
        })
      })
      const options = Array.from(byIndex.values()).sort((a, b) => a.value - b.value)
      options.unshift({ value: 'latest', label: '最新有 parquet 的 Loop' })
      return options
    },
    canLoadMatrix () {
      return this.factorLoops.length > 0 || this.exportableLoops.length > 0 || this.loops.length > 0
    },
    isMatrixLatestLoop () {
      return this.matrixLoopIndex === 'latest' || this.matrixLoopIndex == null
    },
    matrixFactorNames () {
      return (this.matrix && Array.isArray(this.matrix.factor_names)) ? this.matrix.factor_names : []
    },
    matrixSampleColumns () {
      const cols = [
        { title: '日期', dataIndex: 'as_of', key: 'as_of', width: 110, fixed: 'left' },
        { title: '标的', dataIndex: 'symbol', key: 'symbol', width: 100, fixed: 'left' }
      ]
      this.matrixFactorNames.forEach(name => {
        cols.push({
          title: name,
          dataIndex: name,
          key: name,
          width: 110,
          customRender: v => this.fmt(v)
        })
      })
      return cols
    },
    matrixSampleRows () {
      const sample = (this.matrix && Array.isArray(this.matrix.sample)) ? this.matrix.sample : []
      const rows = []
      sample.forEach((day, dayIdx) => {
        const asOf = day && day.as_of
        const dayRows = (day && Array.isArray(day.rows)) ? day.rows : []
        dayRows.forEach((row, rowIdx) => {
          rows.push({
            ...row,
            as_of: asOf,
            _key: `${asOf || dayIdx}-${row.symbol || rowIdx}-${rowIdx}`
          })
        })
      })
      return rows
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
    formatJson (value) {
      if (value == null || value === '') return '—'
      if (typeof value === 'string') return value
      try {
        return JSON.stringify(value, null, 2)
      } catch (e) {
        return String(value)
      }
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
    kindLabel (kind) {
      if (kind === 'model') return '模型'
      if (kind === 'factor') return '因子'
      return ''
    },
    loopOptionLabel (loop) {
      const kind = this.kindLabel(loop && loop.kind) || '因子'
      return `Loop_${loop.loop_index} · ${kind}`
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
    modelFeedbackText (model, key) {
      const fb = (model && model.feedbacks) || {}
      const val = fb[key]
      if (val == null || val === '') {
        if (key === 'final' && model && model.final_feedback) return String(model.final_feedback)
        return '—'
      }
      return String(val)
    },
    resetAndLoad () {
      this.detail = null
      this.error = ''
      this.activeLoop = 0
      this.loopTab = 'research'
      this.activeFactorKey = undefined
      this.codeLoaded = false
      this.logsLoaded = false
      this.equityLoaded = false
      this.evolutionLoaded = false
      this.sotaCodeLoaded = false
      this.matrix = null
      this.matrixError = ''
      this.matrixLoadedFor = null
      this.matrixLoopIndex = 'latest'
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
        this.ensureMatrixLoopSelection()
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
    mergeArtifacts (prevList, nextList) {
      const prevFactors = Array.isArray(prevList) ? prevList : []
      return nextList.map((factor, idx) => {
        const old = prevFactors[idx] || {}
        return {
          ...old,
          ...factor,
          code: factor.code != null ? factor.code : old.code,
          evolution: factor.evolution != null ? factor.evolution : old.evolution,
          feedbacks: factor.feedbacks != null ? factor.feedbacks : old.feedbacks
        }
      })
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
      if (Array.isArray(payload.sota_library)) {
        const prevLib = Array.isArray(next.sota_library) ? next.sota_library : []
        const byName = {}
        prevLib.forEach(item => { byName[item.name] = { ...item } })
        payload.sota_library.forEach(item => {
          const old = byName[item.name] || {}
          byName[item.name] = {
            ...old,
            ...item,
            code: item.code != null ? item.code : old.code
          }
        })
        next.sota_library = Object.keys(byName).sort().map(name => byName[name])
      }
      if (payload.sota_model !== undefined) next.sota_model = payload.sota_model
      if (Array.isArray(payload.exportable_loops)) next.exportable_loops = payload.exportable_loops
      if (payload.summary && typeof payload.summary === 'object') {
        next.summary = { ...(next.summary || {}), ...payload.summary }
      }
      if (Array.isArray(payload.loops) && payload.loops.length) {
        const byIndex = {}
        ;(next.loops || []).forEach(loop => { byIndex[loop.loop_index] = { ...loop } })
        payload.loops.forEach(loop => {
          const prev = byIndex[loop.loop_index] || {}
          const merged = { ...prev, ...loop }
          if (Array.isArray(loop.artifacts) && loop.artifacts.length) {
            merged.artifacts = this.mergeArtifacts(prev.artifacts || prev.factors, loop.artifacts)
            merged.factors = merged.artifacts
          } else if (Array.isArray(loop.factors) && loop.factors.length) {
            merged.factors = this.mergeArtifacts(prev.factors || prev.artifacts, loop.factors)
            merged.artifacts = merged.factors
          } else {
            if (prev.factors) merged.factors = prev.factors
            if (prev.artifacts) merged.artifacts = prev.artifacts
          }
          if (loop.equity_curve == null && prev.equity_curve != null) {
            merged.equity_curve = prev.equity_curve
          }
          if (loop.training_log == null && prev.training_log != null) {
            merged.training_log = prev.training_log
          }
          if (loop.kind == null && prev.kind != null) {
            merged.kind = prev.kind
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
      if (this.loopTab === 'dev' && this.isModelLoop) this.ensureModelExtras()
      if (this.loopTab === 'feedback') this.refreshEquityChart()
      if (this.loopTab === 'evolution') this.ensureEvolution()
      // 矩阵 Tab 使用独立的 matrixLoopIndex，不跟随研发 Loop
    },
    ensureMatrixLoopSelection () {
      const options = this.matrixLoopOptions
      const values = new Set(options.map(opt => opt.value))
      if (values.has(this.matrixLoopIndex)) return
      // Prefer latest factor loop; fall back to "最新有 parquet"
      if (this.factorLoops.length) {
        this.matrixLoopIndex = this.factorLoops[this.factorLoops.length - 1].loop_index
        return
      }
      this.matrixLoopIndex = 'latest'
    },
    onMatrixLoopChange () {
      this.matrix = null
      this.matrixLoadedFor = null
      this.matrixError = ''
      this.loadFactorMatrix()
    },
    onLoopTabChange (key) {
      this.loopTab = key
      if (key === 'dev' && this.isModelLoop) this.ensureModelExtras()
      if (key === 'feedback') this.refreshEquityChart()
      if (key === 'evolution') this.ensureEvolution()
      if (key === 'matrix') this.ensureFactorMatrix()
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
    async onSotaExpand (expanded) {
      if (!expanded) return
      await this.ensureSotaCode()
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
    async ensureLogs () {
      if (this.logsLoaded || this.logsLoading) return
      this.logsLoading = true
      try {
        await this.load('loops,logs', { silent: true })
        this.logsLoaded = true
      } finally {
        this.logsLoading = false
      }
    },
    async ensureModelExtras () {
      await Promise.all([this.ensureCode(), this.ensureLogs()])
    },
    async ensureSotaCode () {
      if (this.sotaCodeLoaded || this.sotaCodeLoading) return
      this.sotaCodeLoading = true
      try {
        await this.load('code,sota_library', { silent: true })
        this.sotaCodeLoaded = true
      } finally {
        this.sotaCodeLoading = false
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
    matrixCacheKey () {
      const loopKey = this.isMatrixLatestLoop ? 'latest' : String(this.matrixLoopIndex)
      return `${this.sessionId}:${loopKey}`
    },
    matrixQueryParams () {
      const params = {
        sample_dates: 5,
        max_symbols: 50
      }
      if (!this.isMatrixLatestLoop) {
        params.loop_index = this.matrixLoopIndex
      }
      return params
    },
    async ensureFactorMatrix () {
      this.ensureMatrixLoopSelection()
      if (!this.canLoadMatrix) {
        this.matrix = null
        this.matrixError = ''
        this.matrixLoadedFor = null
        return
      }
      const key = this.matrixCacheKey()
      if (this.matrixLoadedFor === key && this.matrix) return
      await this.loadFactorMatrix()
    },
    async loadFactorMatrix () {
      if (!this.sessionId) return
      this.ensureMatrixLoopSelection()
      if (!this.canLoadMatrix) {
        this.matrix = null
        this.matrixError = ''
        this.matrixLoadedFor = null
        return
      }
      this.matrixLoading = true
      this.matrixError = ''
      try {
        const res = await fetchFactorMatrix(this.sessionId, this.matrixQueryParams())
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.matrix = this.unwrap(res) || null
        this.matrixLoadedFor = this.matrixCacheKey()
      } catch (error) {
        this.matrix = null
        this.matrixLoadedFor = null
        const msg = error.backendMessage || error.message || '加载因子矩阵失败'
        if (/parquet|not found|404/i.test(String(msg))) {
          this.matrixError = `${msg}。可切换上方矩阵 Loop，或选择「最新有 parquet 的 Loop」。`
        } else {
          this.matrixError = msg
        }
      } finally {
        this.matrixLoading = false
      }
    },
    seriesPoints (rows, key) {
      return rows.map((row, idx) => ({
        value: row[key],
        symbolSize: row.decision === true ? 10 : 6,
        itemStyle: row.decision === true
          ? { borderWidth: 2 }
          : undefined,
        _idx: idx
      }))
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
        legend: {
          data: ['IC', 'Rank IC', '年化收益', '最大回撤'],
          textStyle: { color: text }
        },
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
          { name: 'IC', type: 'line', data: this.seriesPoints(rows, 'ic'), showSymbol: true },
          { name: 'Rank IC', type: 'line', data: this.seriesPoints(rows, 'rank_ic'), showSymbol: true },
          { name: '年化收益', type: 'line', data: this.seriesPoints(rows, 'annualized_return'), showSymbol: true },
          { name: '最大回撤', type: 'line', data: this.seriesPoints(rows, 'max_drawdown'), showSymbol: true }
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
        grid: { left: 48, right: 24, top: 40, bottom: 56 },
        dataZoom: [
          { type: 'inside', start: 0, end: 100 },
          { type: 'slider', start: 0, end: 100, height: 18, bottom: 8 }
        ],
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
    async downloadBlob (blob, filename, failMsg) {
      const file = blob instanceof Blob ? blob : new Blob([blob], { type: 'text/csv;charset=utf-8;' })
      if (file.type && file.type.includes('application/json')) {
        const text = await file.text()
        let msg = failMsg
        try {
          const json = JSON.parse(text)
          msg = json.msg || msg
        } catch (e) { /* ignore */ }
        throw new Error(msg)
      }
      const url = window.URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    },
    async downloadCsv () {
      if (!this.sessionId) return
      this.csvLoading = true
      try {
        const blob = await downloadSessionMetricsCsv(this.sessionId)
        await this.downloadBlob(blob, `session_${this.sessionId}_metrics.csv`, '下载失败')
        this.$message.success('指标 CSV 已下载')
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '下载 CSV 失败')
      } finally {
        this.csvLoading = false
      }
    },
    async downloadMatrixCsv () {
      if (!this.sessionId || !this.canLoadMatrix) return
      this.matrixCsvLoading = true
      try {
        const params = {}
        if (!this.isMatrixLatestLoop) params.loop_index = this.matrixLoopIndex
        const blob = await downloadFactorMatrixCsv(this.sessionId, params)
        const loopPart = !this.isMatrixLatestLoop
          ? `loop${this.matrixLoopIndex}`
          : (this.matrix && this.matrix.loop_index != null ? `loop${this.matrix.loop_index}` : 'latest')
        await this.downloadBlob(
          blob,
          `session_${this.sessionId}_${loopPart}_factor_matrix.csv`,
          '下载失败'
        )
        this.$message.success('因子矩阵 CSV 已下载')
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '下载因子矩阵 CSV 失败')
      } finally {
        this.matrixCsvLoading = false
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
.chart-box-equity {
  height: 320px;
}
.sota-head,
.hyp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0;
}
.sota-model-hint {
  color: #667085;
  font-size: 12px;
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
.model-card {
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px dashed #e5e7eb;
}
.model-card:last-child {
  border-bottom: 0;
}
.model-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.matrix-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.matrix-meta {
  margin-bottom: 12px;
  color: #667085;
  font-size: 12px;
  line-height: 1.6;
}
.factor-name-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 120px;
  overflow: auto;
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
.theme-dark .hyp-text,
.theme-dark .sota-model-hint,
.theme-dark .matrix-meta {
  color: #a7a7a7;
}
.theme-dark .block + .block,
.theme-dark .model-card {
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
  .sota-head,
  .hyp-head {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
