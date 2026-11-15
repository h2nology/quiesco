/**
 * Transport of run events (`@quiesco/protocol` run-events) between a runner's Quiesco reporter and the
 * `quiesco` process: a local socket (Unix socket file, or a named pipe on Windows) carrying NDJSON.
 *
 * - The CLI starts a RunEventServer and passes `server.env()` to the runner it spawns.
 * - Reporters (and workers adding evidence) call `connectRunEvents()`: without QUIESCO_EVENTS it
 *   returns a client that sends nothing, so running the runner directly is unaffected.
 * - A broken connection never fails a test: the client warns once and drops further events.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { RUN_EVENTS_ENV, RUN_EVENTS_PROTOCOL, createRunEventDecoder, encodeRunEvent } from '@quiesco/protocol';
import type { RunEvent, RunnerName } from '@quiesco/protocol';

/** Longest Unix socket path that works everywhere (sun_path is 104 bytes on macOS, 108 on Linux). */
const MAX_SOCKET_PATH = 100;

/** A fresh socket address for this process. */
export function runEventsAddress(platform: NodeJS.Platform = process.platform, tmpdir: string = os.tmpdir()): string {
  const name = `quiesco-${process.pid}-${randomBytes(4).toString('hex')}`;
  if (platform === 'win32') return `\\\\.\\pipe\\${name}`;
  const file = path.join(tmpdir, `${name}.sock`);
  // A long TMPDIR (some CI images) would make the path too long for a Unix socket.
  return file.length <= MAX_SOCKET_PATH ? file : path.join('/tmp', `${name}.sock`);
}

export interface RunEventServerOptions {
  /** Each decoded event, with the connection it came on (1, 2, …). */
  onEvent: (event: RunEvent, connection: number) => void;
  /** A line that is not a known run event (skipped). */
  onInvalid?: (line: string, reason: string) => void;
  /** Default: runEventsAddress(). */
  address?: string;
}

export class RunEventServer {
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  private readonly idleWaiters: (() => void)[] = [];
  private nextConnection = 1;
  private listening = false;
  readonly address: string;
  /** The runners that said hello (a reporter is wired in). */
  readonly hellos: { runner: RunnerName; protocol: number; connection: number }[] = [];

  constructor(private readonly options: RunEventServerOptions) {
    this.address = options.address ?? runEventsAddress();
    this.server = net.createServer((socket) => this.accept(socket));
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.address, () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.listening = true;
    // Only this user may connect (the socket file is created with the process umask).
    if (process.platform !== 'win32') chmodSync(this.address, 0o600);
    return this.address;
  }

  /** Environment for the runner process. */
  env(): Record<string, string> {
    return { [RUN_EVENTS_ENV]: this.address };
  }

  /** Number of open connections. */
  get connections(): number {
    return this.sockets.size;
  }

  /**
   * Resolves once no connection is open, or after `timeoutMs`. Called after the runner exits: its
   * last events may still be in flight on a connection that is closing.
   */
  async drain(timeoutMs = 2000): Promise<void> {
    if (this.sockets.size === 0) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      timer.unref();
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.idleWaiters.push(done);
    });
  }

  /** Stops listening, closes the connections still open and removes the socket file. */
  async close(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (!this.listening) return;
    this.listening = false;
    // net.Server removes its Unix socket file on close.
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: net.Socket): void {
    const connection = this.nextConnection++;
    this.sockets.add(socket);
    socket.setEncoding('utf8');
    const decoder = createRunEventDecoder((event) => {
      if (event.type === 'hello') this.hellos.push({ runner: event.runner, protocol: event.protocol, connection });
      this.options.onEvent(event, connection);
    }, this.options.onInvalid);
    socket.on('data', (chunk: string) => decoder.push(chunk));
    socket.on('end', () => decoder.end());
    socket.on('error', () => {});
    socket.on('close', () => {
      this.sockets.delete(socket);
      if (this.sockets.size === 0) for (const w of this.idleWaiters.splice(0)) w();
    });
  }
}

export interface RunEventClient {
  /** False when QUIESCO_EVENTS is not set or the connection failed: send() does nothing. */
  readonly enabled: boolean;
  send(event: RunEvent): void;
  /** Flushes and closes the connection. Safe to call more than once. */
  close(): Promise<void>;
}

const disabledClient: RunEventClient = {
  enabled: false,
  send() {},
  close: () => Promise.resolve(),
};

export interface ConnectOptions {
  runner: RunnerName;
  runnerVersion?: string;
  env?: NodeJS.ProcessEnv;
  /** Told once when the connection fails. Default: a line on stderr. */
  warn?: (message: string) => void;
}

/**
 * Connects to the `quiesco` process named by QUIESCO_EVENTS and sends `hello`. Events sent before the
 * connection is up are buffered by the socket. The connection does not keep the process alive.
 */
export function connectRunEvents(options: ConnectOptions): RunEventClient {
  const address = (options.env ?? process.env)[RUN_EVENTS_ENV];
  if (address === undefined || address === '') return disabledClient;
  const warn = options.warn ?? ((m: string) => process.stderr.write(`quiesco: ${m}\n`));
  let failed = false;
  let closing: Promise<void> | null = null;
  const socket = net.createConnection(address);
  socket.unref();
  socket.on('error', (e) => {
    if (failed) return;
    failed = true;
    warn(`run events are not sent (progress / UI will not update): ${e.message}`);
    socket.destroy();
  });
  const client: RunEventClient = {
    get enabled() {
      return !failed;
    },
    send(event) {
      if (failed || closing !== null || socket.destroyed) return;
      socket.write(encodeRunEvent(event));
    },
    close() {
      closing ??= new Promise<void>((resolve) => {
        if (failed || socket.destroyed) return resolve();
        // Unref'd so a forgotten client never holds the runner open; while flushing, keep the process alive.
        socket.ref();
        socket.once('close', () => resolve());
        socket.end();
      });
      return closing;
    },
  };
  client.send({ type: 'hello', protocol: RUN_EVENTS_PROTOCOL, runner: options.runner, pid: process.pid, ...(options.runnerVersion !== undefined ? { runnerVersion: options.runnerVersion } : {}) });
  return client;
}
