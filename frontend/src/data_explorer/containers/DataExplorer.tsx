// Libraries
import React, {PureComponent} from 'react'
import {connect} from 'react-redux'
import {bindActionCreators} from 'redux'
import {withRouter, InjectedRouter, WithRouterProps} from 'react-router'
import {Location} from 'history'
import qs from 'qs'
import uuid from 'uuid'
import _ from 'lodash'
import {Subscribe} from 'unstated'

// Utils
import {stripPrefix} from 'src/utils/basepath'
import {GlobalAutoRefresher} from 'src/utils/AutoRefresher'
import {getConfig} from 'src/dashboards/utils/cellGetters'
import {buildRawText} from 'src/utils/influxql'
import {defaultQueryDraft} from 'src/shared/utils/timeMachine'
import {TimeMachineContainer} from 'src/shared/utils/TimeMachineContainer'

// Components
import WriteDataForm from 'src/data_explorer/components/WriteDataForm'
import OverlayTechnology from 'src/reusable_ui/components/overlays/OverlayTechnology'
import SendToDashboardOverlay from 'src/data_explorer/components/SendToDashboardOverlay'
import Authorized, {EDITOR_ROLE} from 'src/auth/Authorized'
import TimeMachine from 'src/shared/components/TimeMachine/TimeMachine'
import DEHeader from 'src/data_explorer/components/DEHeader'
import PageSpinner from 'src/shared/components/PageSpinner'

// Actions
import {errorThrown} from 'src/shared/actions/errors'
import {setAutoRefresh} from 'src/shared/actions/app'
import {
  getDashboardsAsync,
  sendDashboardCellAsync,
} from 'src/dashboards/actions'
import {writeLineProtocolAsync} from 'src/data_explorer/actions/view/write'
import {updateSourceLink as updateSourceLinkAction} from 'src/data_explorer/actions/queries'
import {editQueryStatus as editQueryStatusAction} from 'src/data_explorer/actions/queries'

import {notify as notifyAction} from 'src/shared/actions/notifications'

// Constants
import {
  TEMPLATES,
  TEMP_VAR_DASHBOARD_TIME,
  TEMP_VAR_UPPER_DASHBOARD_TIME,
} from 'src/shared/constants'

// Types
import {
  Source,
  Dashboard,
  QueryConfig,
  QueryStatus,
  Template,
  TemplateType,
  TemplateValueType,
  Notification,
  Cell,
  QueryType,
  CellQuery,
  TimeRange,
  Me,
} from 'src/types'
import {ErrorHandling} from 'src/shared/decorators/errors'
import {Links} from 'src/types/flux'

interface PassedProps {
  source: Source
  sources: Source[]
  queryConfigs: QueryConfig[]
  updateSourceLink: typeof updateSourceLinkAction
  autoRefresh: number
  handleChooseAutoRefresh: () => void
  router?: InjectedRouter
  location?: Location
  manualRefresh: number
  dashboards: Dashboard[]
  onManualRefresh: () => void
  errorThrownAction: () => void
  writeLineProtocol: () => void
  handleGetDashboards: () => Dashboard[]
  sendDashboardCell: (
    dashboard: Dashboard,
    newCell: Partial<Cell>
  ) => Promise<{success: boolean; dashboard: Dashboard}>
  editQueryStatus: typeof editQueryStatusAction
  queryStatus: QueryStatus
  fluxLinks: Links
  notify: (message: Notification) => void
  sourceLink: string
}

interface ConnectedProps {
  queryType: QueryType
  queryDrafts: CellQuery[]
  timeRange: TimeRange
  draftScript: string
  script: string
  onUpdateQueryDrafts: (queryDrafts: CellQuery[]) => void
  onResetTimeMachine: TimeMachineContainer['reset']
  onInitFluxScript: TimeMachineContainer['handleInitFluxScript']
}

interface Auth {
  me: Me
  isUsingAuth: boolean
}

type Props = PassedProps & ConnectedProps & Auth

interface State {
  isWriteFormVisible: boolean
  isSendToDashboardVisible: boolean
  isStaticLegend: boolean
  isComponentMounted: boolean
}

@ErrorHandling
export class DataExplorer extends PureComponent<Props, State> {
  constructor(props) {
    super(props)

    this.state = {
      isWriteFormVisible: false,
      isSendToDashboardVisible: false,
      isStaticLegend: false,
      isComponentMounted: false,
    }

    props.onResetTimeMachine()
  }

  public async componentDidMount() {
    const {autoRefresh} = this.props

    await this.resolveQueryParams()

    GlobalAutoRefresher.poll(autoRefresh)

    this.setState({isComponentMounted: true})
  }

  public componentDidUpdate(prevProps: Props) {
    const {autoRefresh} = this.props

    if (autoRefresh !== prevProps.autoRefresh) {
      GlobalAutoRefresher.poll(autoRefresh)
    }

    if (
      prevProps.location === this.props.location &&
      this.state.isComponentMounted
    ) {
      this.writeQueryParams()
    }
  }

  public componentWillUnmount() {
    GlobalAutoRefresher.stopPolling()
  }

  public render() {
    const {
      source,
      sources,
      editQueryStatus,
      queryStatus,
      fluxLinks,
      notify,
      updateSourceLink,
      timeRange,
      me,
      isUsingAuth,
    } = this.props

    const {isStaticLegend, isComponentMounted} = this.state

    if (!isComponentMounted) {
      return <PageSpinner />
    }

    return (
      <>
        {this.writeDataForm}
        {this.sendToDashboardOverlay}
        <div className="deceo--page">
          <TimeMachine
            notify={notify}
            source={source}
            isInCEO={false}
            sources={sources}
            fluxLinks={fluxLinks}
            templates={this.templates}
            queryStatus={queryStatus}
            isStaticLegend={isStaticLegend}
            editQueryStatus={editQueryStatus}
            updateSourceLink={updateSourceLink}
            onResetFocus={this.handleResetFocus}
            onToggleStaticLegend={this.handleToggleStaticLegend}
            me={me}
            isUsingAuth={isUsingAuth}
          >
            {(activeEditorTab, onSetActiveEditorTab) => (
              <DEHeader
                timeRange={timeRange}
                activeEditorTab={activeEditorTab}
                onOpenWriteData={this.handleOpenWriteData}
                toggleSendToDashboard={this.toggleSendToDashboard}
                onSetActiveEditorTab={onSetActiveEditorTab}
              />
            )}
          </TimeMachine>
        </div>
      </>
    )
  }

  private async resolveQueryParams() {
    const {
      source,
      sourceLink,
      queryDrafts,
      onUpdateQueryDrafts,
      onInitFluxScript,
    } = this.props
    const {query, script} = this.readQueryParams()

    if (script) {
      onInitFluxScript(script)
      return
    }

    if (query) {
      if (queryDrafts.find(q => q.query === query)) {
        // Has matching query draft already loaded
        return
      }

      const id = uuid.v4()
      const queryConfig = await getConfig(
        source.links.queries,
        id,
        query,
        this.templates
      )

      const queryDraft = {
        id,
        query,
        queryConfig,
        source: sourceLink,
        type: QueryType.InfluxQL,
      }

      onUpdateQueryDrafts([queryDraft])
      return
    }

    if (!queryDrafts.length) {
      const queryDraft = defaultQueryDraft(QueryType.InfluxQL)

      onUpdateQueryDrafts([queryDraft])
      return
    }
  }

  private readQueryParams(): {query?: string; script?: string} {
    const {query, script} = qs.parse(location.search, {
      ignoreQueryPrefix: true,
    })

    return {query, script}
  }

  private writeQueryParams() {
    const {router, queryDrafts, script, queryType} = this.props
    const query = _.get(queryDrafts, '0.query')
    const isFlux = queryType === QueryType.Flux

    let queryParams

    if (isFlux && script) {
      queryParams = {script}
    } else if (!isFlux && query) {
      queryParams = {query}
    }

    const pathname = stripPrefix(location.pathname)
    const search = queryParams ? `?${qs.stringify(queryParams)}` : ''

    router.push(pathname + search)
  }

  private get writeDataForm(): JSX.Element {
    const {
      source,
      errorThrownAction,
      writeLineProtocol,
      me,
      isUsingAuth,
    } = this.props

    const {isWriteFormVisible} = this.state
    return (
      <OverlayTechnology visible={isWriteFormVisible}>
        <WriteDataForm
          source={source}
          errorThrown={errorThrownAction}
          selectedDatabase={this.selectedDatabase}
          onClose={this.handleCloseWriteData}
          writeLineProtocol={writeLineProtocol}
          me={me}
          isUsingAuth={isUsingAuth}
        />
      </OverlayTechnology>
    )
  }

  private get sendToDashboardOverlay(): JSX.Element {
    const {
      source,
      dashboards,
      sendDashboardCell,
      handleGetDashboards,
      notify,
      draftScript,
    } = this.props

    const {isSendToDashboardVisible, isStaticLegend} = this.state
    return (
      <Authorized requiredRole={EDITOR_ROLE}>
        <OverlayTechnology visible={isSendToDashboardVisible}>
          <SendToDashboardOverlay
            notify={notify}
            onCancel={this.toggleSendToDashboard}
            queryConfig={this.activeQueryConfig}
            script={draftScript}
            source={source}
            rawText={this.rawText}
            dashboards={dashboards}
            handleGetDashboards={handleGetDashboards}
            sendDashboardCell={sendDashboardCell}
            isStaticLegend={isStaticLegend}
          />
        </OverlayTechnology>
      </Authorized>
    )
  }

  private get templates(): Template[] {
    const {timeRange} = this.props

    const low = timeRange.lower
    const up = timeRange.upper
    const lowerTemplateType =
      low && low.includes(':') ? TemplateType.TimeStamp : TemplateType.Constant
    const upperTemplateType =
      up && up.includes(':') ? TemplateType.TimeStamp : TemplateType.Constant
    const lowerTemplateValueType =
      low && low.includes(':')
        ? TemplateValueType.TimeStamp
        : TemplateValueType.Constant
    const upperTemplateValueType =
      up && up.includes(':')
        ? TemplateValueType.TimeStamp
        : TemplateValueType.Constant

    const dashboardTime: Template = {
      id: 'dashtime',
      tempVar: TEMP_VAR_DASHBOARD_TIME,
      type: lowerTemplateType,
      label: 'minimum bound on dashboard time',
      values: [
        {
          value: low,
          type: lowerTemplateValueType,
          selected: true,
          localSelected: true,
        },
      ],
    }

    const upperDashboardTime: Template = {
      id: 'upperdashtime',
      tempVar: TEMP_VAR_UPPER_DASHBOARD_TIME,
      type: upperTemplateType,
      label: 'upper bound on dashboard time',
      values: [
        {
          value: up || 'now()',
          type: upperTemplateValueType,
          selected: true,
          localSelected: true,
        },
      ],
    }

    return [...TEMPLATES, dashboardTime, upperDashboardTime]
  }

  private handleCloseWriteData = (): void => {
    this.setState({isWriteFormVisible: false})
  }

  private handleOpenWriteData = (): void => {
    this.setState({isWriteFormVisible: true})
  }

  private get selectedDatabase(): string {
    return _.get(this.props.queryConfigs, ['0', 'database'], null)
  }

  private get activeQueryConfig(): QueryConfig {
    const {queryDrafts} = this.props

    return _.get(queryDrafts, '0.queryConfig')
  }

  private get rawText(): string {
    const {timeRange} = this.props

    if (this.activeQueryConfig) {
      return buildRawText(this.activeQueryConfig, timeRange)
    }

    return ''
  }

  private toggleSendToDashboard = () => {
    this.setState({
      isSendToDashboardVisible: !this.state.isSendToDashboardVisible,
    })
  }

  private handleToggleStaticLegend = (isStaticLegend: boolean): void => {
    this.setState({isStaticLegend})
  }

  private handleResetFocus = () => {
    return
  }
}

const ConnectedDataExplorer = (props: PassedProps & WithRouterProps & Auth) => {
  return (
    <Subscribe to={[TimeMachineContainer]}>
      {(container: TimeMachineContainer) => {
        const {state} = container
        return (
          <DataExplorer
            {...props}
            queryDrafts={state.queryDrafts}
            queryType={state.queryType}
            draftScript={state.draftScript}
            timeRange={state.timeRange}
            script={state.script}
            onInitFluxScript={container.handleInitFluxScript}
            onUpdateQueryDrafts={container.handleUpdateQueryDrafts}
            onResetTimeMachine={container.reset}
          />
        )
      }}
    </Subscribe>
  )
}

const mstp = state => {
  const {
    app: {
      persisted: {autoRefresh},
    },
    timeRange,
    dataExplorer: {queryStatus, sourceLink},
    dashboardUI: {dashboards},
    sources,
    links,
  } = state

  return {
    fluxLinks: links.flux,
    autoRefresh,
    timeRange,
    dashboards,
    sources,
    queryStatus,
    sourceLink,
  }
}

const mdtp = dispatch => {
  return {
    handleChooseAutoRefresh: bindActionCreators(setAutoRefresh, dispatch),
    errorThrownAction: bindActionCreators(errorThrown, dispatch),
    writeLineProtocol: bindActionCreators(writeLineProtocolAsync, dispatch),
    handleGetDashboards: bindActionCreators(getDashboardsAsync, dispatch),
    sendDashboardCell: bindActionCreators(sendDashboardCellAsync, dispatch),
    editQueryStatus: bindActionCreators(editQueryStatusAction, dispatch),
    notify: bindActionCreators(notifyAction, dispatch),
    updateSourceLink: bindActionCreators(updateSourceLinkAction, dispatch),
  }
}

export default connect(mstp, mdtp)(withRouter(ConnectedDataExplorer))
