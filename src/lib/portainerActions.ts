// Shared container-action logic for the Containers screen - both the list's
// long-press ActionSheet and the detail page's inline button row build off
// this instead of each hand-rolling their own enabled/disabled rules and
// confirm-dialog wording, so they can't drift apart (same reasoning as the
// shared detail components noted in PLAN.md's Key decisions).
import { portainerApi } from '../api/portainer';
import { ServiceConfig } from '../api/types';
import { alert } from './alert';

export type PortainerAction = 'start' | 'stop' | 'kill' | 'restart' | 'pause' | 'resume' | 'remove' | 'recreate';

export interface PortainerActionDef {
  key: PortainerAction;
  label: string;
  destructive?: boolean;
  enabled: boolean;
}

// Which actions make sense for a container's current Docker `State` -
// mirrors the reference Portainer screenshot's own grayed-out buttons (e.g.
// a running container can't be Started again, a stopped one can't be
// Paused). Remove/Recreate/Restart are always available regardless of
// state, matching Portainer's own behavior.
export function containerActionDefs(state: string): PortainerActionDef[] {
  const running = state === 'running';
  const paused = state === 'paused';

  return [
    { key: 'start', label: 'Start', enabled: !running && !paused },
    { key: 'stop', label: 'Stop', enabled: running || paused },
    { key: 'kill', label: 'Kill', enabled: running || paused },
    { key: 'restart', label: 'Restart', enabled: true },
    { key: 'pause', label: 'Pause', enabled: running },
    { key: 'resume', label: 'Resume', enabled: paused },
    { key: 'remove', label: 'Remove', destructive: true, enabled: true },
    { key: 'recreate', label: 'Recreate', enabled: true },
  ];
}

// Dispatches one action against the Portainer API - the single place that
// maps an action key to the actual `portainerApi` call.
export function runContainerAction(
  config: ServiceConfig,
  containerId: string,
  action: PortainerAction,
  opts?: { pullLatestImage?: boolean }
): Promise<unknown> {
  switch (action) {
    case 'start':
      return portainerApi.startContainer(config, containerId);
    case 'stop':
      return portainerApi.stopContainer(config, containerId);
    case 'kill':
      return portainerApi.killContainer(config, containerId);
    case 'restart':
      return portainerApi.restartContainer(config, containerId);
    case 'pause':
      return portainerApi.pauseContainer(config, containerId);
    case 'resume':
      return portainerApi.resumeContainer(config, containerId);
    case 'remove':
      return portainerApi.removeContainer(config, containerId);
    case 'recreate':
      return portainerApi.recreateContainer(config, containerId, !!opts?.pullLatestImage);
  }
}
// Remove and Recreate both need a confirm step before touching a live
// container - Remove is a plain yes/no, Recreate additionally asks whether
// to pull the latest image first (per the original ask). Every other action
// (Start/Stop/Kill/Restart/Pause/Resume) runs immediately, same as every
// other service's quick actions elsewhere in this app.
export function confirmContainerAction(
  action: PortainerAction,
  containerLabel: string,
  onConfirm: (opts?: { pullLatestImage?: boolean }) => void
): void {
  if (action === 'remove') {
    alert('Remove Container', `Permanently remove "${containerLabel}"? This does not remove its image or volumes.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onConfirm() },
    ]);
    return;
  }
  if (action === 'recreate') {
    alert(
      'Recreate Container',
      `Recreate "${containerLabel}" using its current configuration? This stops and replaces the container.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Recreate', onPress: () => onConfirm({ pullLatestImage: false }) },
        { text: 'Recreate + Pull Latest Image', onPress: () => onConfirm({ pullLatestImage: true }) },
      ]
    );
    return;
  }
  onConfirm();
}
