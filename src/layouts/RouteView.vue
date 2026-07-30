<script lang="jsx">
// Component names must match the `name` option of keepAlive route views.
const KEEP_ALIVE_INCLUDES = [
  'AIAssetAnalysis',
  'StrategyCenter',
  'StrategyIde',
  'BacktestCenter',
  'IndicatorIDE',
  'UniverseManager',
  'BrokerAccounts'
]

export default {
  name: 'RouteView',
  props: {
    keepAlive: {
      type: Boolean,
      default: true
    }
  },
  computed: {
    useKeepAlive () {
      return this.keepAlive !== false
    },
    keepAliveIncludes () {
      return KEEP_ALIVE_INCLUDES
    },
    routeWantsKeepAlive () {
      return Boolean(this.$route && this.$route.meta && this.$route.meta.keepAlive)
    }
  },
  render () {
    // Always keep one <keep-alive> mounted so cached pages (e.g. BacktestCenter)
    // survive navigation to non-cached routes. Switching between two different
    // router-view trees would drop the cache and abort in-flight UI work.
    if (!this.useKeepAlive) {
      return <router-view key={this.$route.fullPath || this.$route.path} />
    }
    return (
      <div class="route-view-keep-alive-host">
        <keep-alive include={this.keepAliveIncludes}>
          {this.routeWantsKeepAlive
            ? <router-view key={this.$route.name || this.$route.path} />
            : null}
        </keep-alive>
        {!this.routeWantsKeepAlive
          ? <router-view key={this.$route.fullPath || this.$route.path} />
          : null}
      </div>
    )
  }
}
</script>
