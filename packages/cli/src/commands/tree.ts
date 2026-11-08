/**
 * `quiesco tree [--platform …] [--launch] [--json] [--timeout ms]` (requirements.md §6.12): print the
 * element tree of the running app, to find testIDs while writing steps.
 *
 * Default: attach to the app that is already running (it reconnects to the configured port), so the
 * tree is the screen you are looking at. `--launch` boots the device and launches the app first, like
 * a test run (the tree is then the start screen).
 */
import type { TreeNode } from '@quiesco/core';
import { attachToRunningApp, createSession, loadConfig, resolvePlatform } from '@quiesco/core';

import type { CliContext } from '../context.js';
import { parsePlatform, takeFlag, takeOption } from '../context.js';

const MAX_TEXT = 60;

/** One line per node: `Type #testID "text" [role]`, indented by depth. */
export function formatTree(root: TreeNode | null): string[] {
  if (root === null) return ['(no element tree: is <QuiescoRoot> mounted?)'];
  const lines: string[] = [];
  const walk = (n: TreeNode, depth: number): void => {
    let line = `${'  '.repeat(depth)}${n.type}`;
    if (n.testID !== undefined) line += ` #${n.testID}`;
    if (n.text !== undefined && n.text !== '') line += ` ${JSON.stringify(n.text.length > MAX_TEXT ? `${n.text.slice(0, MAX_TEXT - 1)}…` : n.text)}`;
    if (n.role !== undefined) line += ` [${n.role}]`;
    lines.push(line);
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(root, 0);
  return lines;
}

export async function treeCommand(args: readonly string[], ctx: CliContext): Promise<number> {
  let rest = [...args];
  const platformOpt = takeOption(rest, '--platform');
  rest = platformOpt.rest;
  const timeoutOpt = takeOption(rest, '--timeout');
  rest = timeoutOpt.rest;
  const launch = takeFlag(rest, '--launch');
  rest = launch.rest;
  const json = takeFlag(rest, '--json');
  rest = json.rest;
  if (rest.length > 0) {
    ctx.err(`quiesco tree: unknown arguments ${rest.join(' ')}`);
    return 2;
  }
  const { config } = await loadConfig({ cwd: ctx.cwd });
  const timeoutMs = timeoutOpt.value !== undefined ? Number(timeoutOpt.value) : undefined;
  let root: TreeNode | null;
  if (launch.present) {
    const platform = resolvePlatform(parsePlatform(platformOpt.value), ctx.env);
    const session = await createSession({ config, platform });
    try {
      root = await session.driver.getTree();
    } finally {
      await session.dispose();
    }
  } else {
    const app = await attachToRunningApp({
      config,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      onListening: (port) => ctx.err(`Waiting for the app on ws://localhost:${port} (start or reload the e2e build)…`),
    });
    try {
      ctx.err(`Connected: ${app.platform}`);
      root = await app.getTree();
    } finally {
      await app.close();
    }
  }
  if (json.present) ctx.out(JSON.stringify(root, null, 2));
  else for (const line of formatTree(root)) ctx.out(line);
  return 0;
}
