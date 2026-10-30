export const OPTIONAL_CONNECTION_IDS = ['telnet', 'ftp', 'serial', 'rdp', 'vnc', 'tftp', 'x11', 'xdmcp'] as const;
export type OptionalConnectionId = typeof OPTIONAL_CONNECTION_IDS[number];

export interface OptionalConnectionToolDefinition {
  readonly id: OptionalConnectionId;
  readonly settingLabel: string;
  readonly description: string;
}

/** Fixed app-owned integrations whose availability can be restricted in Workbench settings. */
export const OPTIONAL_CONNECTION_TOOL_REGISTRY: readonly OptionalConnectionToolDefinition[] = Object.freeze([
  Object.freeze({ id: 'telnet', settingLabel: 'Allow Telnet connections',
    description: 'Telnet traffic is not encrypted. New connections still require the plaintext warning.' }),
  Object.freeze({ id: 'ftp', settingLabel: 'Allow FTP and FTPS connections',
    description: 'Plain FTP still requires a trusted, one-time warning before credentials are sent.' }),
  Object.freeze({ id: 'serial', settingLabel: 'Allow serial port connections',
    description: 'Allows the app to list and open configured Windows COM ports.' }),
  Object.freeze({ id: 'rdp', settingLabel: 'Allow RDP viewer launches',
    description: 'Allows explicit launches of the external Windows Remote Desktop client.' }),
  Object.freeze({ id: 'vnc', settingLabel: 'Allow VNC viewer launches',
    description: 'Allows explicit launches of the configured external VNC viewer.' }),
  Object.freeze({ id: 'tftp', settingLabel: 'Allow the local TFTP server',
    description: 'The server remains loopback-only and serves only the folder you choose.' }),
  Object.freeze({ id: 'x11', settingLabel: 'Allow SSH X11 forwarding',
    description: 'Uses a user-installed Cygwin/X provider. Each connection still requires explicit trusted-host consent.' }),
  Object.freeze({ id: 'xdmcp', settingLabel: 'Allow XDMCP sessions',
    description: 'XDMCP is unencrypted; remote X clients can read or change the integrated Windows clipboard. Each display still requires warning acknowledgement.' })
]);

export const DEFAULT_ENABLED_OPTIONAL_CONNECTIONS: readonly OptionalConnectionId[] = Object.freeze(
  OPTIONAL_CONNECTION_TOOL_REGISTRY.filter(tool => tool.id !== 'x11' && tool.id !== 'xdmcp').map(tool => tool.id)
);

export function isOptionalConnectionId(value: unknown): value is OptionalConnectionId {
  return typeof value === 'string' && OPTIONAL_CONNECTION_IDS.includes(value as OptionalConnectionId);
}

export function normalizeEnabledOptionalConnections(value: unknown): readonly OptionalConnectionId[] | undefined {
  if (!Array.isArray(value) || value.length > OPTIONAL_CONNECTION_TOOL_REGISTRY.length) return undefined;
  const selected = new Set<OptionalConnectionId>();
  for (const candidate of value) {
    if (!isOptionalConnectionId(candidate) || selected.has(candidate)) return undefined;
    selected.add(candidate);
  }
  return Object.freeze(OPTIONAL_CONNECTION_TOOL_REGISTRY.filter(tool => selected.has(tool.id)).map(tool => tool.id));
}
