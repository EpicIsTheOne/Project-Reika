export interface CliOptions {
  mode: 'server' | 'pair' | 'startup' | 'updates' | 'relay' | 'help';
  startupAction?: 'status' | 'enable' | 'disable';
  updatesAction?: 'status' | 'check' | 'apply' | 'enable' | 'disable';
  relayAction?: 'status' | 'set';
  updatesTarget?: 'server' | 'client' | 'all';
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
  } else if (argv[0] === 'updates' || argv[0] === 'update') {
    options.mode = 'updates';
    const action = argv[1] ?? 'status';
    if (action !== 'status' && action !== 'check' && action !== 'apply' && action !== 'enable' && action !== 'disable') {
      throw new Error(`Unknown updates action: ${action}`);
    }
    options.updatesAction = action;
    const maybeTarget = argv[2];
    if (maybeTarget && !maybeTarget.startsWith('-')) {
      if (maybeTarget !== 'server' && maybeTarget !== 'client' && maybeTarget !== 'all') throw new Error(`Unknown updates target: ${maybeTarget}`);
      options.updatesTarget = maybeTarget;
      index = 3;
    } else {
      index = argv[1] ? 2 : 1;
    }
  } else if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    return { mode: 'help' };
  } else if (argv[0] === 'relay') {
    options.mode = 'relay';
    const action = argv[1] ?? 'status';
    if (action !== 'status' && action !== 'set') {
      throw new Error(`Unknown relay action: ${action}`);
    }
    options.relayAction = action;
    index = argv[1] ? 2 : 1;
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
    '  reika-agent-server relay status            Show saved relay URL',
    '  reika-agent-server relay set --relay <url> Change saved relay URL',
    '  reika-agent-server updates status          Show GitHub update status',
    '  reika-agent-server updates check           Check GitHub for updates',
    '  reika-agent-server updates apply           Apply a safe fast-forward update',
    '  reika-agent-server updates enable all      Enable auto update for server and client',
    '  reika-agent-server updates disable client  Disable client auto update',
    '',
    'Commands:',
    '  help                                      Show this help',
    '  pair                                      Connect outbound to the relay with a pairing code',
    '  startup                                   Manage OS startup registration',
    '  relay                                     Manage the saved relay URL used by AgentHub',
    '  updates                                   Manage GitHub repo-backed updates',
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
    '  4. Optional: reika-agent-server relay set --relay ws://relay-host:8790/v1/device',
    '  5. Run: reika-agent-server startup enable --relay ws://relay-host:8790/v1/device',
    '  6. Optional: reika-agent-server updates enable all'
  ].join('\n');
}
