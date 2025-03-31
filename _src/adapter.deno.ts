import process from "node:process";
import crypto from "node:crypto";
import url from "node:url";
import path from "node:path";
import * as _fs from "jsr:@std/fs@1.0.15";
import fs from "node:fs/promises";
import util from "node:util";
import { isIP as _isIP } from "node:net";
import { EventEmitter } from "node:events";

export { fs, path, process, util };

export async function readFileUtf8(...pathParts: string[]): Promise<string> {
  return await Deno.readTextFile(path.join(...pathParts));
}

export function hasFSReadPermission(): boolean {
  return Deno.permissions.querySync({ name: "read" }).state === "granted";
}

export async function readDir(path: string) {
  try {
    const files: string[] = [];

    for await (const entry of Deno.readDir(path)) {
      files.push(entry.name);
    }

    return files;
  } catch {
    return [];
  }
}

export async function walk(path: string, params?: { match?: RegExp[]; skip?: RegExp[] }) {
  const { match, skip } = params || {};
  await _fs.ensureDir(path);

  const entries = _fs.walk(path, { match, skip });
  const files: string[] = [];

  for await (const e of entries) {
    if (!e.isFile)
      continue;

    files.push(e.path);
  }

  return files;
}

export async function exists(fn: string | URL): Promise<boolean> {
  fn = fn instanceof URL ? url.fileURLToPath(fn) : fn;

  try {
    await Deno.lstat(fn);
    return true;
  } catch (_err) {
    return false;
  }
}

export function hashSHA1toHex(msg: string): string {
  return crypto.createHash("sha1").update(msg).digest("hex");
}

export function homeDir(): string {
  const homeDir = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE");

  if (homeDir)
    return homeDir;

  const homeDrive = Deno.env.get("HOMEDRIVE");
  const homePath = Deno.env.get("HOMEPATH");

  if (homeDrive && homePath)
    return path.join(homeDrive, homePath);

  throw new Error("Unable to determine home path");
}

export async function input(message = "", _params?: { silent?: boolean }) {
  const buf = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(message));

  const n = (await Deno.stdin.read(buf)) as number;
  return new TextDecoder().decode(buf.subarray(0, n)).trim();
}

export namespace net {
  export function createConnection(port: number, hostname?: string): Socket;
  export function createConnection(unixpath: string): Socket;

  export function createConnection(port: number | string, hostname?: string): Socket {
    const opts: any =
      typeof port === "string" ?
        { path: port, transport: "unix" } :
        { hostname, port };

    const conn = Deno.connect(opts);
    return new Socket(conn);
  }

  export const isIP = _isIP;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
  export declare interface Socket {
    on(eventName: "close", listener: () => void): this;
    on(eventName: "connect", listener: () => void): this;
    on(eventName: "data", listener: (data: Uint8Array) => void): this;
    on(eventName: "error", listener: (e: any) => void): this;
  }

  export class BaseSocket<T extends Deno.Conn> extends EventEmitter {
    protected _conn: T | null = null;
    protected _paused = true;
    protected _reader: /*Deno.Reader |*/any | null = null;

    setNoDelay() {
      // No deno api for this
    }

    unref() {
      // No deno api for this
      // Without this api, open idle connections will block deno from exiting
      // after all other tasks are finished
      return this;
    }

    ref() {
      // No deno api for this
      return this;
    }

    pause() {
      this._paused = true;
    }

    async resume() {
      this._paused = false;

      while (!this._paused && this._reader) {
        try {
          const buf = new Uint8Array(16 * 1024);
          const bytes = await this._reader.read(buf);

          if (bytes !== null) {
            this.emit("data", buf.subarray(0, bytes));
          } else {
            // I'm assuming when the reader has ended
            // the connection is closed
            this._conn = null;
            this._reader = null;
            this.emit("close");
          }
        } catch (e) {
          this.emit("error", e);
        }
      }
    }

    async write(data: Uint8Array) {
      try {
        await this._conn?.write(data);
      } catch (e) {
        this.emit("error", e);
      }
    }

    destroy(error?: Error) {
      this._conn?.close();
      this._conn = null;
      this._reader = null;

      if (error)
        throw error;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
  export class Socket extends BaseSocket<Deno.Conn> {
    constructor(pconn: Promise<Deno.Conn>) {
      super();

      pconn
        .then((conn) => {
          this._conn = conn;
          this._reader = conn;
          this.emit("connect");
          this.resume();
        })
        .catch((e) => {
          this.emit("error", e);
        });
    }
  }
}

export namespace tls {
  export function connect(options: tls.ConnectionOptions): tls.TLSSocket {
    if (options.host == null)
      throw new Error("host option must be set");

    if (options.port == null)
      throw new Error("port option must be set");

    const conn = Deno.connectTls({
      alpnProtocols: options.ALPNProtocols,
      caCerts: typeof options.ca === "string" ? [options.ca] : options.ca,
      hostname: options.host,
      port: options.port
    });

    return new TLSSocket(conn);
  }

  export function checkServerIdentity(_hostname: string, _cert: object): Error | undefined {
    return undefined;
  }

  export interface ConnectionOptions {
    ALPNProtocols?: string[];
    ca?: string | string[];
    checkServerIdentity?: (a: string, b: any) => Error | undefined;
    host?: string;
    port?: number;
    rejectUnauthorized?: boolean;
    servername?: string;
  }

  export class TLSSocket extends net.BaseSocket<Deno.TlsConn> {
    private _alpnProtocol: string | null = null;

    constructor(pconn: Promise<Deno.TlsConn>) {
      super();

      pconn
        .then(async (conn) => {
          const handshake = await conn.handshake();
          this._alpnProtocol = handshake.alpnProtocol;
          this._conn = conn;
          this._reader = conn;
          this.emit("secureConnect");
          this.resume();
        })
        .catch((e) => {
          this.emit("error", e);
        });
    }

    get alpnProtocol(): string | false {
      return this._alpnProtocol ?? false;
    }
  }
}

export function exit(code?: number) {
  Deno.exit(code);
}

export function srcDir() {
  return new URL(".", import.meta.url).pathname;
}
