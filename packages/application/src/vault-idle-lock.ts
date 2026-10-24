export const VAULT_IDLE_LOCK_DELAY_MS = 15 * 60 * 1_000;

export type ScheduleVaultLock = (callback: () => void, delayMs: number) => () => void;

export class VaultIdleLock {
  private readonly lockVault: () => void;
  private readonly schedule: ScheduleVaultLock;
  private active = false;
  private generation = 0;
  private cancelScheduled: (() => void) | undefined;

  constructor(lockVault: () => void, schedule: ScheduleVaultLock) {
    this.lockVault = lockVault;
    this.schedule = schedule;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.scheduleNextLock();
  }

  noteUserActivity(): void {
    if (this.active) this.scheduleNextLock();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.generation += 1;
    this.cancelScheduled?.();
    this.cancelScheduled = undefined;
  }

  private scheduleNextLock(): void {
    this.generation += 1;
    const generation = this.generation;
    this.cancelScheduled?.();
    this.cancelScheduled = this.schedule(() => {
      if (!this.active || generation !== this.generation) return;
      this.cancelScheduled = undefined;
      this.lockVault();
    }, VAULT_IDLE_LOCK_DELAY_MS);
  }
}
