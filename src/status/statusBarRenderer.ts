import { extractHost, stripPort } from './format';
import { StatusSnapshot } from './statusSnapshot';

/** The bar shows connection health; request details live in the snapshot tooltip. */
export function renderStatusBar(snapshot: Pick<StatusSnapshot, 'host' | 'connection'>): string {
  const connected = snapshot.connection.state === 'ok' || snapshot.connection.state === 'noModels';
  const icon = connected ? '$(vm-active)' : '$(vm-disconnect)';
  return `${icon} ${stripPort(extractHost(snapshot.host)) || 'gateway'}`;
}
