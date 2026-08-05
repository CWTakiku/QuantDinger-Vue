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
        <a-form-item label="标的池">
          <a-select
            v-model="form.universe_code"
            :disabled="!!runningJob || bridgeOffline"
            style="width: 260px"
            :loading="universesLoading"
            show-search
            option-filter-prop="children"
          >
            <a-select-option
              v-for="item in universeOptions"
              :key="item.code"
              :value="item.code"
            >
              {{ item.name || item.code }}{{ item.benchmark_hint ? ` · 基准 ${item.benchmark_hint}` : '' }}
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
        <a-form-item label="循环轮数">
          <a-input-number
            v-model="form.loop_n"
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
        标的池来自 QuantDinger（CNStock）；全市场基准中证全指，指数池用对应指数，手动/自选池用成分等权。
        循环轮数表示完整研究轮次（每轮含假设→编码→回测→反馈）；不是内部 step 数。
      </p>

      <div v-if="statusData" class="status-row">
        <a-tag :color="bridgeConnected ? 'green' : 'red'">
          Bridge {{ bridgeConnected ? '已连接' : '未连接' }}
        </a-tag>
        <a-tag v-if="statusData.workspace_exists === false" color="orange">工作区不存在</a-tag>
        <a-tag v-if="llmSyncTag.color" :color="llmSyncTag.color">{{ llmSyncTag.text }}</a-tag>
        <template v-if="runningJob">
          <a-tag color="blue">运行中</a-tag>
          <span class="status-meta">任务 {{ runningJob.id }} · {{ runningJob.scenario || form.scenario }} · {{ runningJob.loop_n || form.loop_n }} 轮</span>
        </template>
        <template v-else-if="lastJob">
          <a-tag :color="lastJobTag.color">{{ lastJobTag.text }}</a-tag>
          <span class="status-meta">
            最近任务 {{ lastJob.id }}
            · {{ lastJob.scenario || '-' }}
            · {{ lastJob.loop_n != null ? lastJob.loop_n : '-' }} 轮
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
      <p class="import-hint">从所选会话导出预测分数并写入 External Alpha 库，供策略回测与实盘使用。不选 Loop = 最新预测产物。</p>
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
            <a-form-item label="Loop">
              <a-select
                v-model="importForm.loop_index"
                allow-clear
                placeholder="不选 = 最新预测产物"
                :disabled="bridgeOffline || !importForm.session_id"
                :loading="importLoopsLoading"
                @change="onImportLoopChange"
              >
                <a-select-option
                  v-for="loop in exportableLoops"
                  :key="loop.loop_index"
                  :value="loop.loop_index"
                >
                  {{ importLoopOptionLabel(loop) }}
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

    <section class="workspace-card import-card">
      <h2 class="section-title">推理打分（最新行情）</h2>
      <p class="import-hint">
        用会话里已训练的模型（或因子）在当前 Qlib 日历上重新算分并写入 External Alpha。
        与上方「导入分数」不同：导入用的是挖矿当时的 pred.pkl，推理会覆盖到最新交易日。
      </p>
      <a-form layout="vertical" class="import-form">
        <a-row :gutter="16">
          <a-col :xs="24" :md="10">
            <a-form-item label="会话 ID">
              <a-select
                v-model="inferForm.session_id"
                show-search
                allow-clear
                placeholder="选择会话"
                :disabled="bridgeOffline"
                option-filter-prop="children"
              >
                <a-select-option v-for="item in sessions" :key="`infer-${item.id}`" :value="item.id">
                  {{ item.id }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="4">
            <a-form-item label="模式">
              <a-select v-model="inferForm.mode" :disabled="bridgeOffline">
                <a-select-option value="model">模型</a-select-option>
                <a-select-option value="factor">因子合成</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="5">
            <a-form-item label="Loop">
              <a-select
                v-model="inferForm.loop_index"
                allow-clear
                placeholder="不选 = 最新模型"
                :disabled="bridgeOffline || !inferForm.session_id"
                :loading="inferLoopsLoading"
                @change="onInferLoopChange"
              >
                <a-select-option
                  v-for="loop in inferLoopOptions"
                  :key="`infer-loop-${loop.loop_index}`"
                  :value="loop.loop_index"
                >
                  {{ importLoopOptionLabel(loop) }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="5">
            <a-form-item label="最近交易日数">
              <a-input-number
                v-model="inferForm.max_asofs"
                :min="1"
                :max="252"
                style="width: 100%"
                :disabled="bridgeOffline"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="6">
            <a-form-item label="source">
              <a-input v-model="inferForm.source" :disabled="bridgeOffline" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="8">
            <a-form-item label="version">
              <a-input
                v-model="inferForm.version"
                placeholder="留空则自动加 _infer_model/_infer_factor"
                :disabled="bridgeOffline"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="4">
            <a-form-item label="universe">
              <a-input v-model="inferForm.universe" :disabled="bridgeOffline" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item>
          <a-button
            type="primary"
            icon="thunderbolt"
            :loading="inferring"
            :disabled="!inferForm.session_id || bridgeOffline"
            @click="handleInfer"
          >
            推理并导入 External Alpha
          </a-button>
        </a-form-item>
      </a-form>

      <a-alert
        v-if="inferResult"
        type="success"
        show-icon
        class="import-result"
      >
        <template slot="message">
          {{ inferResult.imported ? '已推理并入库' : '已推理' }}
          {{ inferResult.inserted != null ? inferResult.inserted : inferResult.row_count }} 行
          · {{ inferResult.as_of_min }} → {{ inferResult.as_of_max }}
          · mode={{ inferResult.mode }} · version={{ inferResult.version }}
        </template>
        <template slot="description">
          在策略里引用 source/version 即可用最新截面分数做选股。
          <a-button
            v-if="!inferPreview || !(inferPreview.rows && inferPreview.rows.length)"
            type="link"
            size="small"
            style="padding: 0 4px"
            :loading="inferPreviewLoading"
            @click="loadInferPreviewFromResult"
          >
            显示结果表
          </a-button>
        </template>
      </a-alert>

      <div v-if="inferPreview && inferPreview.rows && inferPreview.rows.length" class="infer-preview">
        <div class="infer-preview-head">
          <strong>推理结果预览</strong>
          <span class="infer-preview-meta">
            source={{ inferPreview.source }} · version={{ inferPreview.version }}
            · 当日 {{ inferPreview.total }} 只
            <template v-if="inferPreview.stats && inferPreview.stats.max != null">
              · max={{ formatScore(inferPreview.stats.max) }}
              · mean={{ formatScore(inferPreview.stats.mean) }}
              · min={{ formatScore(inferPreview.stats.min) }}
            </template>
          </span>
        </div>
        <a-form layout="inline" class="infer-preview-form">
          <a-form-item label="交易日">
            <a-select
              v-model="inferPreviewAsOf"
              style="width: 160px"
              :loading="inferPreviewLoading"
              @change="onInferPreviewAsOfChange"
            >
              <a-select-option
                v-for="d in (inferPreview.as_of_dates || [])"
                :key="d"
                :value="d"
              >
                {{ d }}
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item>
            <a-radio-group
              v-model="inferPreviewView"
              size="small"
              button-style="solid"
              @change="onInferPreviewViewChange"
            >
              <a-radio-button value="top">Top {{ inferPreviewLimit }}</a-radio-button>
              <a-radio-button value="bottom">Bottom {{ inferPreviewLimit }}</a-radio-button>
            </a-radio-group>
          </a-form-item>
        </a-form>
        <a-table
          size="small"
          row-key="rank"
          :columns="inferPreviewColumns"
          :data-source="inferPreviewTableRows"
          :pagination="{ pageSize: 20, size: 'small' }"
          :loading="inferPreviewLoading"
          :scroll="{ y: 420 }"
        />
      </div>
    </section>

    <section class="workspace-card import-card">
      <div class="section-head">
        <h2 class="section-title">发布为量化模型</h2>
        <a-button size="small" icon="reload" :loading="publishedModelsLoading" @click="loadPublishedModels">
          刷新列表
        </a-button>
      </div>
      <p class="import-hint">
        将 RD 会话某一 Loop 的模型或因子配方注册为量化模型，供回测与实盘引用（alpha_version 自动绑定）。
      </p>
      <a-form layout="vertical" class="import-form">
        <a-row :gutter="16">
          <a-col :xs="24" :md="10">
            <a-form-item label="会话 ID">
              <a-select
                v-model="publishForm.session_id"
                show-search
                allow-clear
                placeholder="选择会话"
                option-filter-prop="children"
              >
                <a-select-option v-for="item in sessions" :key="`pub-${item.id}`" :value="item.id">
                  {{ item.id }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="5">
            <a-form-item label="Loop" required>
              <a-select
                v-model="publishForm.loop_index"
                placeholder="选择 Loop"
                :disabled="!publishForm.session_id"
                :loading="publishLoopsLoading"
              >
                <a-select-option
                  v-for="loop in publishLoopOptions"
                  :key="`pub-loop-${loop.loop_index}`"
                  :value="loop.loop_index"
                >
                  {{ importLoopOptionLabel(loop) }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="4">
            <a-form-item label="类型">
              <a-select v-model="publishForm.kind" disabled :placeholder="publishForm.loop_index == null ? '随 Loop 自动' : undefined">
                <a-select-option value="model">模型</a-select-option>
                <a-select-option value="factor">因子</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="5">
            <a-form-item label="显示名称" required>
              <a-input v-model="publishForm.display_name" placeholder="如 CSI300 增强模型" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :md="6">
            <a-form-item label="标的池">
              <a-select
                v-model="publishForm.universe"
                show-search
                option-filter-prop="children"
                placeholder="选择标的池"
                :loading="universesLoading"
              >
                <a-select-option
                  v-for="item in universeOptions"
                  :key="`pub-uni-${item.code}`"
                  :value="item.code"
                >
                  {{ item.name || item.code }}（{{ item.code }}）
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item>
          <a-button
            type="primary"
            icon="cloud-upload"
            :loading="publishing"
            :disabled="!canPublish"
            @click="handlePublish"
          >
            发布
          </a-button>
        </a-form-item>
      </a-form>

      <a-alert
        v-if="publishResult"
        type="success"
        show-icon
        class="import-result"
      >
        <template slot="message">
          已发布 · model_key={{ publishResult.model_key }} · alpha_version={{ publishResult.alpha_version }}
        </template>
        <template slot="description">
          {{ publishResult.display_name }}（{{ publishResult.kind }} · {{ publishResult.universe || 'csi300' }}）
        </template>
      </a-alert>

      <a-table
        v-if="publishedModels.length"
        size="small"
        row-key="model_key"
        class="published-models-table"
        :loading="publishedModelsLoading"
        :columns="publishedModelColumns"
        :data-source="publishedModels"
        :pagination="{ pageSize: 5, size: 'small' }"
      >
        <template slot="actions" slot-scope="text, record">
          <a @click="openEditPublishedModel(record)">编辑</a>
          <a-divider type="vertical" />
          <a-popconfirm
            title="确定硬删除该模型？分数面板不会删除。"
            ok-text="删除"
            cancel-text="取消"
            @confirm="handleDeletePublishedModel(record)"
          >
            <a class="danger-link">删除</a>
          </a-popconfirm>
        </template>
      </a-table>

      <a-modal
        title="编辑量化模型"
        :visible="editModelVisible"
        :confirm-loading="editModelSaving"
        ok-text="保存"
        cancel-text="取消"
        destroy-on-close
        @ok="handleSavePublishedModel"
        @cancel="closeEditPublishedModel"
      >
        <a-form layout="vertical">
          <a-form-item label="model_key">
            <a-input :value="editModelForm.model_key" disabled />
          </a-form-item>
          <a-form-item label="显示名称" required>
            <a-input v-model="editModelForm.display_name" placeholder="显示名称" />
          </a-form-item>
          <a-form-item label="标的池" required>
            <a-select
              v-model="editModelForm.universe"
              show-search
              option-filter-prop="children"
              placeholder="选择标的池"
              :loading="universesLoading"
            >
              <a-select-option
                v-for="item in universeOptions"
                :key="`edit-uni-${item.code}`"
                :value="item.code"
              >
                {{ item.name || item.code }}（{{ item.code }}）
              </a-select-option>
            </a-select>
          </a-form-item>
        </a-form>
      </a-modal>
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
  inferFromSession,
  fetchAlphaPreview,
  fetchSessionDetail,
  fetchRdagentDataSources,
  fetchRdagentUniverses,
  startRdagentJob,
  startRdagentUi,
  stopRdagentJob
} from '@/api/rdagent'
import { publishQuantModel, fetchQuantModels, updateQuantModel, deleteQuantModel } from '@/api/quantModels'
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
      universesLoading: false,
      importing: false,
      importLoopsLoading: false,
      exportableLoops: [],
      importResult: null,
      inferring: false,
      inferLoopsLoading: false,
      inferLoopOptions: [],
      inferResult: null,
      inferPreview: null,
      inferPreviewAsOf: undefined,
      inferPreviewLoading: false,
      inferPreviewView: 'top',
      inferPreviewLimit: 50,
      publishing: false,
      publishLoopsLoading: false,
      publishLoopOptions: [],
      publishResult: null,
      publishedModelsLoading: false,
      publishedModels: [],
      publishedModelColumns: [
        { title: 'model_key', dataIndex: 'model_key', key: 'model_key', ellipsis: true },
        { title: '显示名称', dataIndex: 'display_name', key: 'display_name', ellipsis: true },
        { title: '类型', dataIndex: 'kind', key: 'kind', width: 72 },
        { title: 'alpha_version', dataIndex: 'alpha_version', key: 'alpha_version', ellipsis: true },
        { title: 'universe', dataIndex: 'universe', key: 'universe', width: 96 },
        { title: '发布时间', dataIndex: 'published_at', key: 'published_at', width: 180 },
        { title: '操作', key: 'actions', scopedSlots: { customRender: 'actions' }, width: 120 }
      ],
      editModelVisible: false,
      editModelSaving: false,
      editModelForm: {
        model_key: '',
        display_name: '',
        universe: 'csi300'
      },
      publishForm: {
        session_id: undefined,
        loop_index: undefined,
        kind: undefined,
        display_name: '',
        universe: 'csi300'
      },
      inferPreviewColumns: [
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
      ],
      statusData: null,
      runningJob: null,
      lastJob: null,
      previousRunningJobId: null,
      logText: '',
      logJobId: null,
      sessions: [],
      dataSources: [],
      universes: [],
      datesTouched: false,
      form: {
        scenario: 'fin_factor',
        data_source: 'quantmind',
        universe_code: 'csi300',
        start_date: undefined,
        end_date: undefined,
        loop_n: 1
      },
      importForm: {
        session_id: undefined,
        loop_index: undefined,
        source: 'rdagent',
        version: '',
        universe: 'csi300'
      },
      inferForm: {
        session_id: undefined,
        loop_index: undefined,
        mode: 'model',
        max_asofs: 40,
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
    universeOptions () {
      if (this.universes.length) return this.universes
      return [
        { code: '__all_market__', name: '全市场', benchmark_hint: 'SZ000985' },
        { code: 'csi300', name: '沪深300', benchmark_hint: 'SH000300' },
        { code: 'csi500', name: '中证500', benchmark_hint: 'SH000905' }
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
    inferPreviewTableRows () {
      return (this.inferPreview && Array.isArray(this.inferPreview.rows))
        ? this.inferPreview.rows
        : []
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
    canPublish () {
      return !!(
        this.publishForm.session_id &&
        this.publishForm.loop_index != null &&
        this.publishForm.loop_index !== '' &&
        String(this.publishForm.display_name || '').trim()
      )
    },
    sessionRowSelection () {
      return {
        type: 'radio',
        selectedRowKeys: this.selectedSessionKeys,
        onChange: (keys) => {
          this.selectedSessionKeys = keys
          const sid = keys.length ? keys[0] : undefined
          this.importForm.session_id = sid
          this.inferForm.session_id = sid
          this.publishForm.session_id = sid
        }
      }
    }
  },
  watch: {
    'publishForm.session_id' (id, prev) {
      if (id === prev) return
      this.loadPublishLoops(id)
    },
    'publishForm.loop_index' (idx) {
      this.syncPublishKindFromLoop(idx)
    },
    'importForm.session_id' (id, prev) {
      if (id === prev) return
      this.loadExportableLoops(id)
    },
    'inferForm.session_id' (id, prev) {
      if (id === prev) return
      this.loadInferLoops(id)
    },
    'inferForm.mode' () {
      this.updateInferVersionFromLoop()
    }
  },
  mounted () {
    this.refreshAll()
    this.loadPublishedModels()
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
        await Promise.all([
          this.loadStatus(),
          this.loadSessions(),
          this.loadDataSources(),
          this.loadUniverses()
        ])
      } finally {
        this.refreshing = false
      }
    },
    async loadUniverses () {
      this.universesLoading = true
      try {
        const res = await fetchRdagentUniverses()
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const list = this.unwrap(res) || []
        this.universes = Array.isArray(list) ? list : []
        if (!this.universes.some(u => u.code === this.form.universe_code)) {
          const csi = this.universes.find(u => u.code === 'csi300')
          this.form.universe_code = csi ? csi.code : (this.universes[0] && this.universes[0].code) || 'csi300'
        }
      } catch (error) {
        this.universes = []
      } finally {
        this.universesLoading = false
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
          loop_n: this.form.loop_n,
          data_source: this.form.data_source || 'default',
          universe_code: this.form.universe_code || 'csi300'
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
      this.inferForm.session_id = record.id
      this.publishForm.session_id = record.id
    },
    fillImportFromDetail (sessionId) {
      if (!sessionId) return
      this.importForm.session_id = sessionId
      this.inferForm.session_id = sessionId
      this.publishForm.session_id = sessionId
      this.selectedSessionKeys = [sessionId]
      this.$message.success(`已填入导入/推理会话 ${sessionId}`)
    },
    importLoopOptionLabel (loop) {
      if (!loop) return ''
      const kind = loop.kind === 'model' ? '模型' : loop.kind === 'factor' ? '因子' : '因子'
      const artifact = loop.artifact ? ` · ${loop.artifact}` : ''
      return `Loop_${loop.loop_index} · ${kind}${artifact}`
    },
    async loadExportableLoops (sessionId) {
      this.exportableLoops = []
      this.importForm.loop_index = undefined
      this.updateImportVersionFromLoop()
      if (!sessionId) return
      this.importLoopsLoading = true
      try {
        const res = await fetchSessionDetail(sessionId, 'summary')
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const payload = this.unwrap(res) || {}
        const loops = payload.exportable_loops ||
          (payload.summary && payload.summary.exportable_loops) ||
          []
        this.exportableLoops = Array.isArray(loops) ? loops : []
      } catch (error) {
        this.exportableLoops = []
        this.$message.warning(error.backendMessage || error.message || '加载可导出 Loop 失败')
      } finally {
        this.importLoopsLoading = false
      }
    },
    async loadInferLoops (sessionId) {
      this.inferLoopOptions = []
      this.inferForm.loop_index = undefined
      this.updateInferVersionFromLoop()
      if (!sessionId) return
      this.inferLoopsLoading = true
      try {
        const res = await fetchSessionDetail(sessionId, 'summary')
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const payload = this.unwrap(res) || {}
        const loops = payload.exportable_loops ||
          (payload.summary && payload.summary.exportable_loops) ||
          []
        this.inferLoopOptions = Array.isArray(loops) ? loops : []
      } catch (error) {
        this.inferLoopOptions = []
        this.$message.warning(error.backendMessage || error.message || '加载可推理 Loop 失败')
      } finally {
        this.inferLoopsLoading = false
      }
    },
    onImportLoopChange () {
      this.updateImportVersionFromLoop()
    },
    onInferLoopChange () {
      this.updateInferVersionFromLoop()
    },
    updateImportVersionFromLoop () {
      const sid = this.importForm.session_id
      const idx = this.importForm.loop_index
      if (sid && idx != null && idx !== '') {
        this.importForm.version = `session_${sid}_loop${idx}`
      } else {
        this.importForm.version = ''
      }
    },
    updateInferVersionFromLoop () {
      const sid = this.inferForm.session_id
      const idx = this.inferForm.loop_index
      const mode = this.inferForm.mode || 'model'
      if (sid && idx != null && idx !== '') {
        this.inferForm.version = `session_${sid}_loop${idx}_infer_${mode}`
      } else if (sid) {
        this.inferForm.version = `session_${sid}_infer_${mode}`
      } else {
        this.inferForm.version = ''
      }
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
        if (this.importForm.loop_index != null && this.importForm.loop_index !== '') {
          payload.loop_index = Number(this.importForm.loop_index)
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
    },
    async handleInfer () {
      if (!this.inferForm.session_id) {
        this.$message.warning('请先选择会话')
        return
      }
      this.inferring = true
      this.inferResult = null
      this.inferPreview = null
      this.inferPreviewAsOf = undefined
      try {
        const payload = {
          session_id: this.inferForm.session_id,
          source: this.inferForm.source || 'rdagent',
          universe: this.inferForm.universe || 'csi300',
          mode: this.inferForm.mode || 'model',
          max_asofs: Number(this.inferForm.max_asofs) || 40,
          import: true
        }
        if (this.inferForm.version && String(this.inferForm.version).trim()) {
          payload.version = String(this.inferForm.version).trim()
        }
        if (this.inferForm.loop_index != null && this.inferForm.loop_index !== '') {
          payload.loop_index = Number(this.inferForm.loop_index)
        }
        const res = await inferFromSession(payload)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.inferResult = this.unwrap(res) || {}
        this.applyInferPreview(this.inferResult.preview)
        const n = this.inferResult.inserted != null
          ? this.inferResult.inserted
          : this.inferResult.row_count
        this.$message.success(
          `推理完成 ${this.inferResult.as_of_min || ''} → ${this.inferResult.as_of_max || ''}，入库 ${n || 0} 行`
        )
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '推理失败')
      } finally {
        this.inferring = false
      }
    },
    formatScore (val) {
      if (val == null || val === '') return '—'
      const n = Number(val)
      if (Number.isNaN(n)) return String(val)
      return n.toFixed(6)
    },
    applyInferPreview (preview) {
      this.inferPreview = preview && typeof preview === 'object' ? preview : null
      this.inferPreviewAsOf = this.inferPreview && this.inferPreview.as_of
        ? this.inferPreview.as_of
        : undefined
      this.inferPreviewView = 'top'
    },
    async loadInferPreview () {
      const source = (this.inferResult && this.inferResult.source) || this.inferForm.source || 'rdagent'
      const version = (this.inferResult && this.inferResult.version) || this.inferForm.version
      if (!version) return
      this.inferPreviewLoading = true
      try {
        const res = await fetchAlphaPreview({
          source,
          version,
          as_of: this.inferPreviewAsOf,
          limit: this.inferPreviewLimit,
          order: this.inferPreviewView === 'bottom' ? 'asc' : 'desc'
        })
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const payload = this.unwrap(res) || {}
        this.inferPreview = payload
        if (payload.as_of) this.inferPreviewAsOf = payload.as_of
      } catch (error) {
        this.$message.warning(error.backendMessage || error.message || '加载预览失败')
      } finally {
        this.inferPreviewLoading = false
      }
    },
    onInferPreviewAsOfChange () {
      this.loadInferPreview()
    },
    onInferPreviewViewChange () {
      this.loadInferPreview()
    },
    loadInferPreviewFromResult () {
      if (this.inferResult && this.inferResult.as_of_max) {
        this.inferPreviewAsOf = this.inferResult.as_of_max
      }
      return this.loadInferPreview()
    },
    syncPublishKindFromLoop (loopIndex) {
      if (loopIndex == null || loopIndex === '') {
        this.publishForm.kind = undefined
        return
      }
      const loop = (this.publishLoopOptions || []).find(
        item => Number(item.loop_index) === Number(loopIndex)
      )
      const kind = loop && String(loop.kind || '').toLowerCase()
      this.publishForm.kind = kind === 'model' || kind === 'factor' ? kind : 'factor'
    },
    async loadPublishLoops (sessionId) {
      this.publishLoopOptions = []
      this.publishForm.loop_index = undefined
      this.publishForm.kind = undefined
      if (!sessionId) return
      this.publishLoopsLoading = true
      try {
        const res = await fetchSessionDetail(sessionId, 'summary')
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        const payload = this.unwrap(res) || {}
        const loops = payload.exportable_loops ||
          (payload.summary && payload.summary.exportable_loops) ||
          []
        this.publishLoopOptions = Array.isArray(loops) ? loops : []
      } catch (error) {
        this.publishLoopOptions = []
        this.$message.warning(error.backendMessage || error.message || '加载可发布 Loop 失败')
      } finally {
        this.publishLoopsLoading = false
      }
    },
    async loadPublishedModels () {
      this.publishedModelsLoading = true
      try {
        const res = await fetchQuantModels({ status: 'published' })
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.publishedModels = this.unwrap(res) || []
      } catch (error) {
        this.publishedModels = []
        this.$message.warning(error.backendMessage || error.message || '加载已发布模型失败')
      } finally {
        this.publishedModelsLoading = false
      }
    },
    async handlePublish () {
      if (!this.canPublish) {
        this.$message.warning('请填写会话、Loop 与显示名称')
        return
      }
      this.syncPublishKindFromLoop(this.publishForm.loop_index)
      this.publishing = true
      this.publishResult = null
      try {
        const payload = {
          session_id: this.publishForm.session_id,
          loop_index: Number(this.publishForm.loop_index),
          kind: this.publishForm.kind || 'factor',
          display_name: String(this.publishForm.display_name).trim(),
          universe: this.publishForm.universe || 'csi300'
        }
        const res = await publishQuantModel(payload)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.publishResult = this.unwrap(res) || {}
        this.$message.success(`已发布 ${this.publishResult.model_key}`)
        await this.loadPublishedModels()
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '发布失败')
      } finally {
        this.publishing = false
      }
    },
    openEditPublishedModel (record) {
      if (!record) return
      this.editModelForm = {
        model_key: record.model_key,
        display_name: record.display_name || '',
        universe: record.universe || 'csi300'
      }
      this.editModelVisible = true
      if (!this.universes.length) this.loadUniverses()
    },
    closeEditPublishedModel () {
      this.editModelVisible = false
      this.editModelSaving = false
    },
    async handleSavePublishedModel () {
      const key = String(this.editModelForm.model_key || '').trim()
      const name = String(this.editModelForm.display_name || '').trim()
      const universe = String(this.editModelForm.universe || '').trim() || 'csi300'
      if (!key) return
      if (!name) {
        this.$message.warning('请填写显示名称')
        return
      }
      this.editModelSaving = true
      try {
        const res = await updateQuantModel(key, { display_name: name, universe })
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.$message.success('已保存')
        this.editModelVisible = false
        await this.loadPublishedModels()
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '保存失败')
      } finally {
        this.editModelSaving = false
      }
    },
    async handleDeletePublishedModel (record) {
      const key = record && record.model_key
      if (!key) return
      try {
        const res = await deleteQuantModel(key)
        if (!this.isSuccess(res)) throw new Error(res && res.msg)
        this.$message.success(`已删除 ${key}`)
        await this.loadPublishedModels()
      } catch (error) {
        this.$message.error(error.backendMessage || error.message || '删除失败')
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
.danger-link {
  color: #cf1322;
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
.published-models-table {
  margin-top: 16px;
}
.infer-preview {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #e5e7eb;
}
.infer-preview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.infer-preview-meta {
  color: #667085;
  font-size: 12px;
}
.infer-preview-form {
  margin-bottom: 8px;
}
.theme-dark .import-hint {
  color: #a7a7a7;
}
.theme-dark .infer-preview {
  border-top-color: #303030;
}
.theme-dark .infer-preview-meta {
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
