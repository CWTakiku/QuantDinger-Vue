<template>
  <div class="stock-picker-page" :class="{ 'theme-dark': isDarkTheme }">
    <header class="page-header">
      <div>
        <span class="kicker">Quant Models</span>
        <h1>{{ $t('menu.dashboard.stockPicker') }}</h1>
        <p>从已发布量化模型中查看因子组成，并按交易日刷新 Top-N 分数。</p>
      </div>
      <div class="header-actions">
        <a-button icon="reload" :loading="modelsLoading" @click="loadModels">刷新列表</a-button>
      </div>
    </header>

    <a-empty v-if="!modelsLoading && !models.length" class="empty-state">
      <span slot="description">暂无已发布模型，请先在研究工厂发布。</span>
      <a-button type="primary" href="/#/rdagent">前往研究工厂</a-button>
    </a-empty>

    <template v-else>
      <a-card size="small" :bordered="false" class="panel-card toolbar-card">
        <a-form layout="inline" class="preview-form">
          <a-form-item label="模型">
            <a-select
              v-model="selectedKey"
              show-search
              allow-clear
              option-filter-prop="children"
              :loading="modelsLoading"
              placeholder="请选择已发布模型"
              style="min-width: 280px; max-width: 420px; width: 36vw"
              @change="onModelChange"
            >
              <a-select-option v-for="m in models" :key="m.model_key" :value="m.model_key">
                {{ modelOptionLabel(m) }}
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="交易日">
            <a-date-picker
              v-model="asOfMoment"
              :disabled="!detail"
              :allow-clear="true"
              placeholder="选择日期"
              style="width: 160px"
              @change="onAsOfPickerChange"
            />
          </a-form-item>
          <a-form-item label="Top N">
            <a-input-number
              v-model="topN"
              :min="5"
              :max="100"
              :disabled="!detail"
              @change="onTopNChange"
            />
          </a-form-item>
          <a-form-item>
            <a-button
              type="primary"
              icon="sync"
              :loading="ensuring"
              :disabled="!detail || !asOf"
              @click="handleEnsure"
            >
              刷新分数
            </a-button>
          </a-form-item>
        </a-form>
        <p v-if="detail" class="preview-meta">
          source={{ detail.alpha_source }} · version={{ detail.alpha_version }}
          <template v-if="asOf"> · as_of={{ asOf }}</template>
          <template v-if="asOfDates.length"> · 已有分数日 {{ asOfDates.length }} 个</template>
        </p>
      </a-card>

      <a-row :gutter="16" class="main-grid">
        <a-col v-if="showCompositionPanel" :xs="24" :lg="10">
          <a-card title="模型组成" size="small" :bordered="false" class="panel-card">
            <a-spin :spinning="compositionLoading">
              <template v-if="detail">
                <div v-if="composition && composition.available" class="composition-body">
                  <div class="composition-head">
                    <a-tag color="geekblue">{{ kindLabel(composition.kind) }}</a-tag>
                    <span v-if="composition.session_id" class="composition-meta">
                      会话 {{ composition.session_id }} · Loop {{ composition.loop_index }}
                    </span>
                  </div>

                  <div v-if="composition.learner" class="learner-card">
                    <strong>{{ composition.learner.name || 'Learner' }}</strong>
                    <div class="learner-meta">
                      <span v-if="composition.learner.model_type">类型 {{ composition.learner.model_type }}</span>
                      <span v-if="composition.learner.architecture">架构 {{ composition.learner.architecture }}</span>
                    </div>
                  </div>
                  <a-tag v-else-if="composition.kind === 'factor'" color="default">纯因子</a-tag>
                  <a-tag v-else color="default">学习器信息暂不可用</a-tag>

                  <a-table
                    size="small"
                    row-key="name"
                    class="factors-table"
                    :columns="factorColumns"
                    :data-source="composition.factors || []"
                    :pagination="false"
                    :scroll="{ y: 360 }"
                  />
                </div>
                <template v-else-if="composition">
                  <a-alert
                    type="warning"
                    show-icon
                    :message="composition.bridge_error ? '无法加载模型组成' : '组成不可用'"
                    :description="composition.bridge_error || '请确认 rdagent-bridge 已启动且会话数据完整。'"
                  />
                  <div class="composition-provenance-fallback">
                    <a-tag color="geekblue">{{ kindLabel(composition.kind) }}</a-tag>
                    <span v-if="composition.session_id" class="composition-meta">
                      会话 {{ composition.session_id }} · Loop {{ composition.loop_index }}
                    </span>
                    <span v-else class="composition-meta">溯源信息不完整</span>
                    <a-button
                      v-if="composition.session_id"
                      type="link"
                      size="small"
                      class="rdagent-link"
                      href="/#/rdagent"
                    >
                      前往研究工厂
                    </a-button>
                  </div>
                </template>
                <a-alert
                  v-else
                  type="warning"
                  show-icon
                  message="组成不可用"
                  description="请确认 rdagent-bridge 已启动且会话数据完整。"
                />
              </template>
            </a-spin>
          </a-card>
        </a-col>

        <a-col :xs="24" :lg="showCompositionPanel ? 14 : 24">
          <a-card title="Top-N 分数" size="small" :bordered="false" class="panel-card">
            <a-empty v-if="!selectedKey" description="请先在上方选择模型" />
            <a-table
              v-else
              size="small"
              row-key="rank"
              :loading="previewLoading"
              :columns="previewColumns"
              :data-source="previewRows"
              :pagination="{ pageSize: 20, size: 'small' }"
              :scroll="{ y: 420 }"
            />
          </a-card>
        </a-col>
      </a-row>
    </template>
  </div>
</template>

<script>
import moment from 'moment'
import { mapState } from 'vuex'
import { fetchQuantModels, fetchQuantModel, ensureQuantModelScores } from '@/api/quantModels'
import { fetchAlphaPreview } from '@/api/rdagent'

export default {
  name: 'StockPicker',
  data () {
    return {
      selectedKey: undefined,
      models: [],
      modelsLoading: false,
      detail: null,
      compositionLoading: false,
      asOf: undefined,
      asOfDates: [],
      topN: 30,
      previewRows: [],
      previewLoading: false,
      ensuring: false,
      factorColumns: [
        { title: '因子', dataIndex: 'name', key: 'name', width: 120, ellipsis: true },
        { title: '公式', dataIndex: 'formulation', key: 'formulation', ellipsis: true },
        { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true }
      ],
      previewColumns: [
        { title: '排名', dataIndex: 'rank', key: 'rank', width: 72 },
        {
          title: '代码',
          dataIndex: 'symbol',
          key: 'symbol',
          width: 150,
          customRender: (text) => {
            const s = String(text || '')
            return s.replace(/^CNStock:/i, '') || '—'
          }
        },
        {
          title: '股票名称',
          dataIndex: 'name',
          key: 'name',
          ellipsis: true,
          customRender: (text) => (text == null || text === '' ? '—' : text)
        },
        {
          title: '分数',
          dataIndex: 'score',
          key: 'score',
          width: 120,
          customRender: (text) => (text == null || text === '' ? '—' : Number(text).toFixed(6))
        }
      ]
    }
  },
  computed: {
    ...mapState({ navTheme: state => state.app.theme }),
    isDarkTheme () { return ['dark', 'realdark'].includes(this.navTheme) },
    composition () {
      return (this.detail && this.detail.composition) || null
    },
    showCompositionPanel () {
      return Boolean(this.selectedKey || this.compositionLoading)
    },
    asOfMoment: {
      get () {
        return this.asOf ? moment(this.asOf, 'YYYY-MM-DD') : null
      },
      set (value) {
        if (!value) {
          this.asOf = undefined
          return
        }
        this.asOf = moment.isMoment(value)
          ? value.format('YYYY-MM-DD')
          : String(value).slice(0, 10)
      }
    }
  },
  mounted () {
    this.loadModels()
  },
  methods: {
    unwrap (res) {
      if (!res) return null
      if (res.data !== undefined) return res.data
      return res
    },
    isSuccess (res) {
      if (!res) return false
      if (typeof res.code === 'number') return res.code === 1 || res.code === 200
      return true
    },
    kindLabel (kind) {
      const k = String(kind || '').toLowerCase()
      if (k === 'model') return '模型'
      if (k === 'factor') return '因子'
      return k || '—'
    },
    modelOptionLabel (record) {
      const name = (record && record.display_name) || (record && record.model_key) || '—'
      const kind = this.kindLabel(record && record.kind)
      return `${name}（${kind}）`
    },
    onModelChange (modelKey) {
      const key = modelKey || ''
      if (!key) {
        this.selectedKey = undefined
        this.detail = null
        this.previewRows = []
        this.asOfDates = []
        this.asOf = undefined
        return
      }
      this.selectedKey = key
      this.asOf = undefined
      this.loadDetail()
    },
    async loadModels () {
      this.modelsLoading = true
      try {
        const res = await fetchQuantModels({ status: 'published' })
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.models = this.unwrap(res) || []
        if (this.selectedKey && !this.models.some(m => m.model_key === this.selectedKey)) {
          this.selectedKey = undefined
          this.detail = null
          this.previewRows = []
          this.asOfDates = []
          this.asOf = undefined
        }
      } catch (error) {
        this.models = []
        this.$message.error(error.backendMessage || error.message || '加载模型列表失败')
      } finally {
        this.modelsLoading = false
      }
    },
    async loadDetail () {
      if (!this.selectedKey) {
        this.detail = null
        return
      }
      this.compositionLoading = true
      this.previewRows = []
      this.asOfDates = []
      try {
        const res = await fetchQuantModel(this.selectedKey)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.detail = this.unwrap(res) || null
        if (this.asOf) {
          await this.loadPreview()
        }
      } catch (error) {
        this.detail = null
        this.$message.error(error.backendMessage || error.message || '加载模型详情失败')
      } finally {
        this.compositionLoading = false
      }
    },
    async loadPreview ({ quietSnap } = {}) {
      if (!this.detail || !this.detail.alpha_source || !this.detail.alpha_version) return
      this.previewLoading = true
      try {
        const requested = this.asOf
        const res = await fetchAlphaPreview({
          source: this.detail.alpha_source,
          version: this.detail.alpha_version,
          as_of: this.asOf,
          limit: this.topN,
          order: 'desc'
        })
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const payload = this.unwrap(res) || {}
        this.previewRows = (payload.rows || []).slice(0, this.topN)
        const payloadAsOf = payload.as_of ? String(payload.as_of).slice(0, 10) : ''
        // Align picker when API PIT-snaps (no exact panel day for requested date).
        if (payloadAsOf && (!this.asOf || this.asOf !== payloadAsOf)) {
          const prev = this.asOf
          this.asOf = payloadAsOf
          if (prev && prev !== payloadAsOf && !quietSnap) {
            this.$message.info(`${prev} 无精确分数截面，已对齐到 ${payloadAsOf}`)
          }
        }
        if (Array.isArray(payload.as_of_dates) && payload.as_of_dates.length) {
          this.asOfDates = payload.as_of_dates
        }
        if (requested && !(payload.rows || []).length) {
          this.$message.warning('该交易日暂无分数，请换日或先刷新')
        }
      } catch (error) {
        this.previewRows = []
        this.$message.warning(error.backendMessage || error.message || '加载预览失败')
      } finally {
        this.previewLoading = false
      }
    },
    async handleEnsure () {
      if (!this.selectedKey) {
        this.$message.warning('请先选择模型')
        return
      }
      if (!this.asOf) {
        this.$message.warning('请先选择交易日')
        return
      }
      this.ensuring = true
      try {
        const prev = this.asOf
        const body = { as_ofs: [this.asOf] }
        const res = await ensureQuantModelScores(this.selectedKey, body)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const ensureData = this.unwrap(res) || {}
        const reason = ensureData.sync_reason
        const meta = ensureData.export_meta || {}
        const effective = Array.isArray(ensureData.effective_as_ofs) ? ensureData.effective_as_ofs : []
        const snapped = (meta.as_of_max || meta.infer_end || (effective.length ? effective[effective.length - 1] : '') || '').toString().slice(0, 10)
        const inferred = Number(ensureData.inferred || 0)
        const qlib = ensureData.qlib_update || {}
        const qlibFailed = qlib && qlib.ok === false
        const qlibOk = qlib && qlib.ok === true
        if (reason === 'not_closed') {
          if (snapped) this.asOf = snapped
          this.$message.warning(`当日未收盘，已显示最近分数日 ${snapped || '—'}`)
        } else if (reason === 'future') {
          this.$message.warning('不能刷新未来交易日')
        } else if (qlibFailed) {
          const detail = qlib.reason || qlib.error || reason || '未知错误'
          this.$message.error(`行情同步失败：${detail}`)
          if (snapped) this.asOf = snapped
        } else if (snapped && snapped !== prev && (inferred > 0 || qlibOk)) {
          this.asOf = snapped
          this.$message.success(`已同步行情并刷新至 ${snapped}`)
        } else if (inferred > 0) {
          this.$message.success('分数已刷新')
        } else {
          this.$message.success('分数已就绪')
        }
        await this.loadPreview({ quietSnap: true })
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '刷新分数失败')
      } finally {
        this.ensuring = false
      }
    },
    onAsOfPickerChange (value) {
      if (!value) {
        this.asOf = undefined
        this.previewRows = []
        return
      }
      this.asOf = moment.isMoment(value)
        ? value.format('YYYY-MM-DD')
        : String(value).slice(0, 10)
      this.loadPreview()
    },
    onTopNChange () {
      if (this.detail && this.asOf) {
        this.loadPreview()
      }
    }
  }
}
</script>

<style lang="less" scoped>
.stock-picker-page {
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
.empty-state {
  margin-top: 48px;
}
.toolbar-card {
  margin-bottom: 16px;
}
.main-grid {
  align-items: flex-start;
}
.panel-card {
  margin-bottom: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #fff;
}
.composition-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.composition-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.composition-meta {
  color: #667085;
  font-size: 12px;
}
.composition-provenance-fallback {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.rdagent-link {
  padding: 0;
  height: auto;
}
.learner-card {
  padding: 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #f7f8fa;
}
.learner-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 6px;
  color: #667085;
  font-size: 12px;
}
.factors-table {
  margin-top: 4px;
}
.preview-form {
  margin-bottom: 8px;
}
.preview-meta {
  margin: 0;
  color: #667085;
  font-size: 12px;
}
.theme-dark {
  background: #0b0b0b;
  color: #f5f5f5;
}
.theme-dark h1 {
  color: #f5f5f5;
}
.theme-dark .page-header p,
.theme-dark .composition-meta,
.theme-dark .preview-meta,
.theme-dark .learner-meta {
  color: #a7a7a7;
}
.theme-dark .panel-card {
  border-color: #2b2b2b;
  background: #151515;
}
.theme-dark .learner-card {
  border-color: #303030;
  background: #1d1d1d;
}
@media (max-width: 992px) {
  .stock-picker-page {
    padding: 14px;
  }
  .page-header {
    flex-direction: column;
  }
}
</style>
