import type { HostInput } from '@quiesco/protocol';

import type { DeviceProvider, LaunchParams } from '../../src/devices/provider';
import type { Permission } from '../../src/devices/permissions';

/** Records calls; `onLaunch` usually connects a fake agent. */
export class FakeProvider implements DeviceProvider {
  readonly platform = 'android' as const;
  calls: string[] = [];
  inputs: HostInput[] = [];
  constructor(private readonly onLaunch: (p: LaunchParams) => void = () => {}) {}
  async boot() {
    this.calls.push('boot');
  }
  async install() {
    this.calls.push('install');
  }
  async launch(p: LaunchParams) {
    this.calls.push('launch');
    this.onLaunch(p);
  }
  async terminate() {
    this.calls.push('terminate');
  }
  async grantPermissions(perms: readonly Permission[]) {
    this.calls.push(`grant:${perms.join(',')}`);
  }
  async screenshot() {
    return Buffer.from('png');
  }
  async injectInput(input: HostInput) {
    this.inputs.push(input);
  }
  async shutdown() {
    this.calls.push('shutdown');
  }
  async diagnose(p: LaunchParams) {
    return [`fake diagnosis for port ${p.port}`];
  }
}
