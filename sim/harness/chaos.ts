import { execSync } from 'child_process';

/**
 * SIMULATOR.md §3 — container control. Wraps docker compose so scenarios can
 * pause/kill/restart infra and observe how the app behaves. Nothing here
 * touches application code; it talks to the running stack the way a failing
 * network does.
 *
 * Guards: every chaos action is a no-op (returns a marker) when the target
 * container isn't part of this compose project, so a scenario never fails on
 * a typo in a container name in an environment where it can't run anyway.
 */

export interface ChaosResult {
  action: string;
  target: string;
  ran: boolean;
  detail?: string;
}

function compose(args: string): string {
  return execSync(`docker compose ${args}`, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
}

function containers(): string[] {
  try {
    return compose('ps --format {{.Names}}').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function hasContainer(name: string): boolean {
  return containers().some((c) => c === name || c.endsWith(`_${name}`));
}

/** Pause a container for `ms` — SIGSTOP: connections hang, no RST. */
export async function pauseContainer(service: string, ms: number): Promise<ChaosResult> {
  if (!hasContainer(service)) return { action: 'pause', target: service, ran: false, detail: 'container not present' };
  try {
    compose(`pause ${service}`);
  } catch {
    /* paused already */
  }
  await new Promise((r) => setTimeout(r, ms));
  try {
    compose(`unpause ${service}`);
  } catch {
    /* not paused */
  }
  return { action: 'pause', target: service, ran: true };
}

/** Kill + restart a container (a crash, not a partition). */
export async function killAndRestart(service: string, waitMs = 1500): Promise<ChaosResult> {
  if (!hasContainer(service)) return { action: 'kill', target: service, ran: false, detail: 'container not present' };
  try {
    compose(`kill ${service}`);
  } catch {
    /* not running */
  }
  await new Promise((r) => setTimeout(r, waitMs));
  try {
    compose(`up -d ${service}`);
  } catch {
    /* no such service in compose */
  }
  return { action: 'kill-restart', target: service, ran: true };
}

/** Wait until a service container reports healthy (or just exists). */
export async function waitHealthy(service: string, attempts = 30, everyMs = 1000): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    if (!hasContainer(service)) return false;
    const status = compose(`ps --filter name=${service} --format {{.Status}}`);
    if (status.includes('healthy') || status.includes('Up')) return true;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return false;
}