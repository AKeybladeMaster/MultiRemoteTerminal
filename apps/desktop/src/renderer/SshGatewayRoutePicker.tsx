import type { ReactElement } from 'react';
import { MAX_SSH_GATEWAY_HOPS } from '../../../../packages/domain/src/ssh-route.ts';
import { canonicalizeSshHostEndpoint, hostEndpointKey } from '../../../../packages/domain/src/host-trust.ts';
import type { SshHostEndpoint } from '../../../../packages/domain/src/host-trust.ts';
import type { SavedSessionDefinition } from '../../../../packages/domain/src/session-definition.ts';

type SshGatewayProfile = Extract<SavedSessionDefinition, { readonly kind: 'ssh' }>;

export interface SshGatewayProfileLabelInput {
  readonly name: string;
  readonly host: string;
  readonly port: number;
}

export interface SshGatewayRoutePickerProps {
  readonly idPrefix: string;
  readonly profiles: readonly SshGatewayProfile[];
  readonly targetEndpoint: SshHostEndpoint | undefined;
  readonly selectedProfileIds: readonly string[];
  readonly disabled?: boolean;
  readonly onChange: (profileIds: readonly string[]) => void;
}

const NO_GATEWAY_LABELS = ['Choose a saved SSH profile', 'No second gateway', 'No third gateway'] as const;

export function formatSshGatewayProfileLabel(profile: SshGatewayProfileLabelInput): string {
  const host = profile.host.includes(':') ? `[${profile.host}]` : profile.host;
  return `${profile.name}  ·  ${host}:${profile.port}`;
}

export function SshGatewayRoutePicker({ idPrefix, profiles, targetEndpoint, selectedProfileIds, disabled = false, onChange }: SshGatewayRoutePickerProps): ReactElement {
  const targetKey = targetEndpoint ? hostEndpointKey(targetEndpoint) : undefined;
  const normalizedProfiles = profiles.flatMap(profile => {
    const endpoint = canonicalizeSshHostEndpoint({ host: profile.host, port: profile.port });
    return endpoint ? [{ profile, endpointKey: hostEndpointKey(endpoint) }] : [];
  });
  const endpointByProfileId = new Map(normalizedProfiles.map(({ profile, endpointKey }) => [profile.id, endpointKey]));

  return <div className="ssh-gateway-route-picker">
    {Array.from({ length: MAX_SSH_GATEWAY_HOPS }, (_, index) => {
      const selectedId = selectedProfileIds[index] ?? '';
      const priorProfileIds = selectedProfileIds.slice(0, index);
      const priorEndpoints = new Set(priorProfileIds.flatMap(id => {
        const endpointKey = endpointByProfileId.get(id);
        return endpointKey ? [endpointKey] : [];
      }));
      const label = `SSH gateway ${index + 1}${index === 0 ? '' : ' (optional)'}`;
      const id = `${idPrefix}-gateway-${index + 1}`;
      const placeholder = NO_GATEWAY_LABELS[index] ?? `No gateway ${index + 1}`;

      return <div className="ssh-gateway-route-slot" key={id}>
        <label htmlFor={id}>{label}</label>
        <select id={id} name={`${idPrefix}Gateway${index + 1}`} value={selectedId}
          disabled={disabled || (index > 0 && !selectedProfileIds[index - 1])}
          onChange={event => {
            const next = selectedProfileIds.slice(0, index);
            if (event.target.value) next[index] = event.target.value;
            onChange(next);
          }}>
          <option value="">{placeholder}</option>
          {normalizedProfiles.filter(({ profile, endpointKey }) => endpointKey !== targetKey &&
            !priorProfileIds.includes(profile.id) && !priorEndpoints.has(endpointKey))
            .map(({ profile }) => <option key={profile.id} value={profile.id}>{formatSshGatewayProfileLabel(profile)}</option>)}
        </select>
      </div>;
    })}
  </div>;
}
