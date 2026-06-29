export interface CliOptions {
  mode: 'server' | 'pair' | 'startup' | 'help';
  startupAction?: 'status' | 'enable' | 'disable';
  relayUrl?: string;
  code?: string;
  deviceId?: string;
  noUi?: boolean;
}

function readValue(args: string[], index: number, name: string) {
  const value = args[index + 1];
  if (!value || value.startsWith('-')) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseCliArgs(argv = process.argv.slice(2)): CliOptions {
  const options: CliOptions = { mode: 'server' };
  let index = 0;

  if (argv[0] === 'pair') {
    options.mode = 'pair';
    index = 1;
  } else if (argv[0] === 'startup') {
    options.mode = 'startup';
    const action = argv[1] ?? 'status';
    if (action !== 'status' && action !== 'enable' && action !== 'disable') {
      throw new Error(`Unknown startup action: ${action}`);
    }
    options.startupAction = action;
    index = argv[1] ? 2 : 1;
  } else if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    return { mode: 'help' };
  }

  while (index < argv.length) {
    const arg = argv[index];
    switch (arg) {
      case '--relay':
      case '--relay-url':
        options.relayUrl = readValue(argv, index, arg);
        index += 2;
        break;
      case '--code':
      case '--pairing-code':
        options.code = readValue(argv, index, arg);
        index += 2;
        break;
      case '--device-id':
        options.deviceId = readValue(argv, index, arg);
        index += 2;
        break;
      case '--no-ui':
        options.noUi = true;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function helpText() {
  return [
    'Project Reika Agent Server',
    '',
    'Usage:',
    '  reika-agent-server                         Start local server',
    '  reika-agent-server pair --code <code>      Start and pair from the terminal',
    '  reika-agent-server startup status          Show startup status',
    '  reika-agent-server startup enable          Start this agent when you sign in',
    '  reika-agent-server startup disable         Disable automatic startup',
    '',
    'Commands:',
    '  help                                      Show this help',
    '  pair                                      Connect outbound to the relay with a pairing code',
    '  startup                                   Manage OS startup registration',
    '',
    'Options:',
    '  --relay <url>       Relay device WebSocket URL. Default: env REIKA_RELAY_URL or bundled default',
    '  --code <code>       Pairing code created in AgentHub',
    '  --device-id <id>    Override device id',
    '  --no-ui            Disable the Windows pairing browser UI',
    '  --help             Show this help',
    '',
    'Linux flow:',
    '  1. Create a pairing code in AgentHub.',
    '  2. Run: reika-agent-server pair --code YOUR_CODE --relay ws://relay-host:8790/v1/device',
    '  3. Approve the device in AgentHub.',
    '  4. Run: reika-agent-server startup enable --relay ws://relay-host:8790/v1/device'
  ].join('\n');
}
