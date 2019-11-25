import React, { PureComponent } from 'react';
import _ from 'lodash';

// Components
import Threesizer from 'src/shared/components/threesizer/Threesizer';
import AgentConfigurationTable from 'src/agent_admin/components/AgentConfigurationTable';
import FancyScrollbar from 'src/shared/components/FancyScrollbar';
import AgentCodeEditor from 'src/agent_admin/components/AgentCodeEditor';
import AgentToolbarFunction from 'src/agent_admin/components/AgentToolbarFunction';
import PageSpinner from 'src/shared/components/PageSpinner';

import { ErrorHandling } from 'src/shared/decorators/errors';

// APIs
import {
	getMinionKeyListAllAsync,
	runLocalServiceStartTelegraf,
	runLocalServiceStopTelegraf,
	getLocalFileRead,
	getLocalFileWrite,
	runLocalServiceReStartTelegraf,
	getLocalServiceGetRunning,
	getRunnerSaltCmdTelegraf
} from 'src/agent_admin/apis';

//const
import { HANDLE_HORIZONTAL, HANDLE_VERTICAL } from 'src/shared/constants';

// Types
import { Minion, RemoteDataState } from 'src/types';
interface Props {
	currentUrl: string;
}

interface State {
	MinionsObject: { [x: string]: Minion };
	configPageStatus: RemoteDataState;
	measurementsStatus: RemoteDataState;
	collectorConfigStatus: RemoteDataState;
	measurementsTitle: string;
	serviceMeasurements: {
		name: string;
		isActivity: boolean;
	}[];
	defaultMeasurements: {
		name: string;
		isActivity: boolean;
	}[];
	horizontalProportions: number[];
	verticalProportions: number[];
	description: string;
	focusedMeasure: Readonly<{}>;
	focusedMeasurePosition: Readonly<{}>;
	refresh: boolean;
	script: string;
	selectHost: string;
	responseMessage: string;
	defaultService: string[];
	focusedHost: string;
}

const defaultMeasurementsData = [
	'global setting',
	'cpu',
	'disk',
	'diskio',
	'mem',
	'net',
	'netstat',
	'ping',
	'processes',
	'system',
	'swap',
	'temp'
];

@ErrorHandling
class AgentConfiguration extends PureComponent<Props, State> {
	constructor(props) {
		super(props);
		this.state = {
			MinionsObject: {},
			configPageStatus: RemoteDataState.NotStarted,
			measurementsStatus: RemoteDataState.NotStarted,
			collectorConfigStatus: RemoteDataState.NotStarted,
			measurementsTitle: '',
			serviceMeasurements: [],
			defaultMeasurements: [],
			horizontalProportions: [0.43, 0.57],
			verticalProportions: [0.43, 0.57],
			description: '',
			focusedMeasure: '',
			focusedMeasurePosition: {},
			refresh: false,
			script: '',
			selectHost: '',
			responseMessage: '',
			focusedHost: '',
			defaultService: [
				'apache',
				'nginx',
				'iis',
				'docker',
				'influxdb',
				'mysqld',
				'mssql',
				'mongodb',
				'postgresql',
				'redis',
				'activemq',
				'rabbitmq',
				'kafka',
				'zookeeper',
				'tomcat',
				'rsyslog'
			]
		};
	}

	getWheelKeyListAll = async () => {
		const hostListObject = await getMinionKeyListAllAsync();

		this.setState({
			MinionsObject: hostListObject,
			configPageStatus: RemoteDataState.Done,
			collectorConfigStatus: RemoteDataState.Done
		});
	};

	private get MeasurementsContent() {
		const { measurementsStatus } = this.state;

		if (measurementsStatus === RemoteDataState.Error) {
			return this.ErrorState;
		}
		// if (serviceMeasurements.length === 0) {
		//   return this.NoMeasurementsState
		// }

		return this.MeasurementsContentBody;
	}

	private get CollectorConfigContent() {
		const { collectorConfigStatus } = this.state;

		// if (collectorConfigStatus === RemoteDataState.Loading) {
		//   return this.LoadingState;
		// }

		if (collectorConfigStatus === RemoteDataState.Error) {
			return this.ErrorState;
		}

		return this.CollectorConfigBody;
	}

	private get LoadingState(): JSX.Element {
		return (
			<div
				style={{
					position: 'absolute',
					zIndex: 7,
					backgroundColor: 'rgba(0,0,0,0.5)',
					width: '100%',
					height: '100%'
				}}
			>
				<PageSpinner />
			</div>
		);
	}

	private get ErrorState(): JSX.Element {
		return (
			<div className="generic-empty-state" >
				<h4 style={{ margin: '90px 0' }}>There was a problem loading data</h4>
			</div>
		);
	}

	// private get NoMeasurementsState(): JSX.Element {
	//   return (
	//     <div className="generic-empty-state">
	//       <h4 style={{margin: '90px 0'}}>No data found</h4>
	//     </div>
	//   )
	// }

	public onClickTableRowCall = (host: string, ip: string) => () => {
		console.log(host);

		this.setState({
			configPageStatus: RemoteDataState.Loading,
			measurementsStatus: RemoteDataState.Loading,
			collectorConfigStatus: RemoteDataState.Loading,
			focusedHost: host
		});

		const getLocalFileReadPromise = getLocalFileRead(host);

		getLocalFileReadPromise.then((pLocalFileReadData) => {
			this.setState({
				script: pLocalFileReadData.data.return[0][host],
				selectHost: host,
				collectorConfigStatus: RemoteDataState.Done,
				configPageStatus: RemoteDataState.Done
			});
		});

		const getLocalServiceGetRunningPromise = getLocalServiceGetRunning(host);

		getLocalServiceGetRunningPromise.then((pLocalServiceGetRunningData) => {
			console.log(pLocalServiceGetRunningData.data.return[0][host]);
			let getServiceRunning = this.state.defaultService
				.filter((m) => pLocalServiceGetRunningData.data.return[0][host].includes(m))
				.map((sMeasure) => {
					return {
						name: sMeasure,
						isActivity: false
					};
				});

			let getDefaultMeasure = defaultMeasurementsData.map((dMeasure) => {
				return {
					name: dMeasure,
					isActivity: false
				};
			});

			// for (const k of pLocalServiceGetRunningData.data.return[0][host]) {
			//   //console.log(k)
			//   if (~this.state.defaultService.indexOf(k)) {
			//     console.log(k)
			//     getServiceRunning.push(k)
			//   }
			// }

			console.log(getServiceRunning);
			console.log(getDefaultMeasure);

			this.setState({
				serviceMeasurements: getServiceRunning,
				defaultMeasurements: getDefaultMeasure,
				measurementsTitle: host + '-' + ip,
				measurementsStatus: RemoteDataState.Done
			});
		});
	};

	public onClickActionCall = (host: string, isRunning: boolean) => () => {
		if (isRunning === false) {
			const getLocalServiceStartTelegrafPromise = runLocalServiceStartTelegraf(host);

			getLocalServiceStartTelegrafPromise.then((pLocalServiceStartTelegrafData) => {
				console.log(pLocalServiceStartTelegrafData);
				this.getWheelKeyListAll();
			});
		} else {
			const getLocalServiceStopTelegrafPromise = runLocalServiceStopTelegraf(host);

			getLocalServiceStopTelegrafPromise.then((pLocalServiceStopTelegrafData) => {
				console.log(pLocalServiceStopTelegrafData);
				this.getWheelKeyListAll();
			});
		}
		// return console.log('action Called', host, isRunning)
	};

	// public onClickSaveCall() {
	//   return console.log("Save Called", this);
	// }

	// public onClickTestCall() {
	//   return console.log("Test Called", this);
	// }

	public onClickApplyCall = () => {
		const { selectHost, script } = this.state;

		console.log('Apply Called', selectHost, script);
		this.setState({
			configPageStatus: RemoteDataState.Loading,
			collectorConfigStatus: RemoteDataState.Loading
		});
		const getLocalFileWritePromise = getLocalFileWrite(selectHost, script);

		getLocalFileWritePromise.then((pLocalFileWriteData) => {
			this.setState({
				responseMessage: pLocalFileWriteData.data.return[0][selectHost]
			});

			console.log('Apply Response Message:', pLocalFileWriteData.data.return[0][selectHost]);

			const getLocalServiceReStartTelegrafPromise = runLocalServiceReStartTelegraf(selectHost);

			getLocalServiceReStartTelegrafPromise.then((pLocalServiceReStartTelegrafData) => {
				console.log(pLocalServiceReStartTelegrafData);
				this.getWheelKeyListAll();
			});
		});
	};

	public async componentDidMount() {
		this.getWheelKeyListAll();

		this.setState({ configPageStatus: RemoteDataState.Loading });

		console.debug('componentDidMount');
	}

	render() {
		const { isUserAuthorized } = this.props;
		return (
			<>
				{isUserAuthorized ? (
					<div className="panel panel-solid">
						<Threesizer
							orientation={HANDLE_HORIZONTAL}
							divisions={this.horizontalDivisions}
							onResize={this.horizontalHandleResize}
						/>
					</div>
				) : (
						<div className="generic-empty-state" style={{ backgroundColor: '#292933' }}>
							<h4>Not Allowed User</h4>
						</div>
					)}
			</>
		);
	}

	private handleFocusedServiceMeasure = ({ clickPosition, _thisProps }) => {
		const { serviceMeasurements, defaultMeasurements } = this.state;

		const mapServiceMeasurements = serviceMeasurements.map((m) => {
			m.isActivity = false;
			return m;
		});

		const mapDefaultMeasurements = defaultMeasurements.map((m) => {
			m.isActivity = false;
			return m;
		});

		serviceMeasurements[_thisProps.idx].isActivity === false
			? (serviceMeasurements[_thisProps.idx].isActivity = true)
			: (serviceMeasurements[_thisProps.idx].isActivity = false);

		console.log(mapServiceMeasurements);

		const getRunnerSaltCmdTelegrafPromise = getRunnerSaltCmdTelegraf(_thisProps.name);

		let getDescription = '';

		getRunnerSaltCmdTelegrafPromise.then((pRunnerSaltCmdTelegrafData) => {
			console.log(pRunnerSaltCmdTelegrafData.data.return[0]);

			this.setState({
				serviceMeasurements: [...mapServiceMeasurements],
				defaultMeasurements: [...mapDefaultMeasurements],
				focusedMeasure: _thisProps.name,
				focusedMeasurePosition: clickPosition,
				description: pRunnerSaltCmdTelegrafData.data.return[0]
			});

			// getDescription = JSON.stringify(pRunnerSaltCmdTelegrafData.data.return[0])
		});

		console.log(getDescription);

		// this.setState({
		//   serviceMeasurements: [...mapServiceMeasurements],
		//   defaultMeasurements: [...mapDefaultMeasurements],
		//   focusedMeasure: _thisProps.name,
		//   focusedMeasurePosition: clickPosition,
		//   description: getDescription,
		// })
	};

	private handleFocusedDefaultMeasure = ({ clickPosition, _thisProps }) => {
		const { defaultMeasurements, serviceMeasurements } = this.state;

		const mapDefaultMeasurements = defaultMeasurements.map((m) => {
			m.isActivity = false;
			return m;
		});

		const mapServiceMeasurements = serviceMeasurements.map((m) => {
			m.isActivity = false;
			return m;
		});

		defaultMeasurements[_thisProps.idx].isActivity === false
			? (defaultMeasurements[_thisProps.idx].isActivity = true)
			: (defaultMeasurements[_thisProps.idx].isActivity = false);

		console.log(defaultMeasurements);

		if (_thisProps.name === 'global setting') {
			this.setState({
				defaultMeasurements: [...mapDefaultMeasurements],
				serviceMeasurements: [...mapServiceMeasurements],
				focusedMeasure: _thisProps.name,
				focusedMeasurePosition: clickPosition,
				description: `[agent]
  ## Default data collection interval for all inputs
  interval = "10s"
  ## Rounds collection interval to 'interval'
  ## ie, if interval="10s" then always collect on :00, :10, :20, etc.
  round_interval = true

  ## Telegraf will send metrics to outputs in batches of at most
  ## metric_batch_size metrics.
  ## This controls the size of writes that Telegraf sends to output plugins.
  metric_batch_size = 1000

  ## Maximum number of unwritten metrics per output.
  metric_buffer_limit = 10000

  ## Collection jitter is used to jitter the collection by a random amount.
  ## Each plugin will sleep for a random time within jitter before collecting.
  ## This can be used to avoid many plugins querying things like sysfs at the
  ## same time, which can have a measurable effect on the system.
  collection_jitter = "0s"

  ## Default flushing interval for all outputs. Maximum flush_interval will be
  ## flush_interval + flush_jitter
  flush_interval = "10s"
  ## Jitter the flush interval by a random amount. This is primarily to avoid
  ## large write spikes for users running a large number of telegraf instances.
  ## ie, a jitter of 5s and interval 10s means flushes will happen every 10-15s
  flush_jitter = "0s"

  ## By default or when set to "0s", precision will be set to the same
  ## timestamp order as the collection interval, with the maximum being 1s.
  ##   ie, when interval = "10s", precision will be "1s"
  ##       when interval = "250ms", precision will be "1ms"
  ## Precision will NOT be used for service inputs. It is up to each individual
  ## service input to set the timestamp at the appropriate precision.
  ## Valid time units are "ns", "us" (or "쨉s"), "ms", "s".
  precision = ""

  ## Log at debug level.
  # debug = false
  ## Log only error level messages.
  # quiet = false

  ## Log file name, the empty string means to log to stderr.
  # logfile = ""

  ## The logfile will be rotated after the time interval specified.  When set
  ## to 0 no time based rotation is performed.  Logs are rotated only when
  ## written to, if there is no log activity rotation may be delayed.
  # logfile_rotation_interval = "0d"

  ## The logfile will be rotated when it becomes larger than the specified
  ## size.  When set to 0 no size based rotation is performed.
  # logfile_rotation_max_size = "0MB"

  ## Maximum number of rotated archives to keep, any older logs are deleted.
  ## If set to -1, no archives are removed.
  # logfile_rotation_max_archives = 5

  ## Override default hostname, if empty use os.Hostname()
  hostname = ""
  ## If set to true, do no set the "host" tag in the telegraf agent.
  omit_hostname = false`
			});
		} else {
			const getRunnerSaltCmdTelegrafPromise = getRunnerSaltCmdTelegraf(_thisProps.name);

			// let getDescription = '';

			// console.log(getDescription);

			getRunnerSaltCmdTelegrafPromise.then((pRunnerSaltCmdTelegrafData) => {
				console.log(pRunnerSaltCmdTelegrafData.data.return[0]);

				this.setState({
					defaultMeasurements: [...mapDefaultMeasurements],
					serviceMeasurements: [...mapServiceMeasurements],
					focusedMeasure: _thisProps.name,
					focusedMeasurePosition: clickPosition,
					description: pRunnerSaltCmdTelegrafData.data.return[0]
				});
				// getDescription = JSON.stringify(pRunnerSaltCmdTelegrafData.data.return[0])
			});
		}

	};

	private handleServiceClose = () => {
		const { serviceMeasurements, defaultMeasurements } = this.state;

		console.log(defaultMeasurements);

		const mapServiceMeasurements = serviceMeasurements.map((m) => {
			m.isActivity = false;
			return m;
		});

		this.setState({
			serviceMeasurements: [...mapServiceMeasurements],
			focusedMeasure: '',
			focusedMeasurePosition: []
		});
	};

	private handleDefaultClose = () => {
		const { defaultMeasurements, serviceMeasurements } = this.state;

		console.log(serviceMeasurements);

		const mapDefaultMeasurements = defaultMeasurements.map((m) => {
			m.isActivity = false;
			return m;
		});

		this.setState({
			defaultMeasurements: [...mapDefaultMeasurements],
			focusedMeasure: '',
			focusedMeasurePosition: []
		});
	};

	private horizontalHandleResize = (horizontalProportions: number[]) => {
		this.setState({ horizontalProportions });
	};

	private verticalHandleResize = (verticalProportions: number[]) => {
		this.setState({ verticalProportions });
	};

	private onChangeScript = (script) => {
		console.log('onChangeScript');
		this.setState({ script });
	};

	private renderAgentPageTop = () => {
		const { MinionsObject, configPageStatus, focusedHost } = this.state;

		return (
			<AgentConfigurationTable
				minions={_.values(MinionsObject)}
				configPageStatus={configPageStatus}
				onClickTableRow={this.onClickTableRowCall}
				onClickAction={this.onClickActionCall}
				focusedHost={focusedHost}
			/>
		);
	};

	private renderAgentPageBottom = () => {
		return (
			<Threesizer
				orientation={HANDLE_VERTICAL}
				divisions={this.verticalDivisions}
				onResize={this.verticalHandleResize}
			/>
		);
	};

	private Measurements() {
		const { measurementsTitle, measurementsStatus } = this.state;
		return (
			<div className="panel">
				{measurementsStatus === RemoteDataState.Loading ? this.LoadingState : null}
				<div className="panel-heading">
					<h2
						className="panel-title"
						style={{
							width: '100%'
						}}
					>
						measurements
						<div
							style={{
								color: '#f58220',
								fontSize: '12px',
								background: '#232323',
								padding: '10px',
								margin: '5px 0px',
								width: '100%'
							}}
						>
							{measurementsTitle}
						</div>
					</h2>
				</div>
				<div className="panel-body">{this.MeasurementsContent}</div>
			</div>
		);
	}

	private get MeasurementsContentBody() {
		const {
			serviceMeasurements,
			defaultMeasurements,
			description,
			focusedMeasure,
			focusedMeasurePosition,
			refresh
		} = this.state;
		return (
			<FancyScrollbar>
				<div
					style={{
						color: '#f58220',
						fontSize: '12px',
						background: '#232323',
						padding: '10px',
						margin: '5px 0px',
						width: '100%'
					}}
				>
					{' '}
					(Service)
				</div>
				<div className="query-builder--list">
					{serviceMeasurements.map((v, i) => {
						return (
							<AgentToolbarFunction
								name={v.name}
								isActivity={v.isActivity}
								key={i}
								idx={i}
								handleFocusedMeasure={this.handleFocusedServiceMeasure.bind(this)}
								handleClose={this.handleServiceClose}
								description={description}
								focusedMeasure={focusedMeasure}
								focusedPosition={focusedMeasurePosition}
								refresh={refresh}
							/>
						);
					})}
				</div>
				<div
					style={{
						color: '#f58220',
						fontSize: '12px',
						background: '#232323',
						padding: '10px',
						margin: '5px 0px',
						width: '100%'
					}}
				>
					{' '}
					(Default measurements)
				</div>
				<div className="query-builder--list">
					{defaultMeasurements.map((v, i) => {
						return (
							<AgentToolbarFunction
								name={v.name}
								isActivity={v.isActivity}
								key={i}
								idx={i}
								handleFocusedMeasure={this.handleFocusedDefaultMeasure.bind(this)}
								handleClose={this.handleDefaultClose}
								description={description}
								focusedMeasure={focusedMeasure}
								focusedPosition={focusedMeasurePosition}
								refresh={refresh}
							/>
						);
					})}
				</div>
			</FancyScrollbar>
		);
	}

	private CollectorConfig() {
		const { collectorConfigStatus } = this.state;
		return (
			<div className="panel">
				{collectorConfigStatus === RemoteDataState.Loading ? this.LoadingState : null}
				<div className="panel-heading">
					<h2 className="panel-title">collector.conf</h2>
					<div>
						<button
							className="btn btn-inline_block btn-default"
							style={{
								marginLeft: '5px'
							}}
							onClick={this.onClickApplyCall}
						>
							APPLY
						</button>
					</div>
				</div>

				<div className="panel-body">{this.CollectorConfigContent}</div>
			</div>
		);
	}

	private get CollectorConfigBody() {
		return (
			<div
				style={{
					width: '100%',
					height: '100%',
					overflow: 'hidden',
					position: 'relative'
				}}
			>
				<AgentCodeEditor script={this.state.script} onChangeScript={this.onChangeScript} />
			</div>
		);
	}

	private get horizontalDivisions() {
		const { horizontalProportions } = this.state;
		const [topSize, bottomSize] = horizontalProportions;

		return [
			{
				name: '',
				handleDisplay: 'none',
				headerButtons: [],
				menuOptions: [],
				render: this.renderAgentPageTop,
				headerOrientation: HANDLE_HORIZONTAL,
				size: topSize
			},
			{
				name: '',
				handlePixels: 8,
				headerButtons: [],
				menuOptions: [],
				render: this.renderAgentPageBottom,
				headerOrientation: HANDLE_HORIZONTAL,
				size: bottomSize
			}
		];
	}

	private get verticalDivisions() {
		const { verticalProportions } = this.state;
		const [rightSize, leftSize] = verticalProportions;

		return [
			{
				name: '',
				handleDisplay: 'none',
				headerButtons: [],
				menuOptions: [],
				render: this.Measurements.bind(this),
				headerOrientation: HANDLE_VERTICAL,
				size: rightSize
			},
			{
				name: '',
				handlePixels: 8,
				headerButtons: [],
				menuOptions: [],
				render: this.CollectorConfig.bind(this),
				headerOrientation: HANDLE_VERTICAL,
				size: leftSize
			}
		];
	}
}

export default AgentConfiguration;