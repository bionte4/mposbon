import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP, Socket } from 'node:net';

const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT_MS = 4_000;
const WRITE_TIMEOUT_MS = 8_000;
const MAX_PAYLOAD_BYTES = 256 * 1024;

export type NetworkPrinterInput = {
  host: string;
  port?: number;
  dataBase64: string;
};

/**
 * ESC/POS raw print over TCP (common LAN thermal port 9100).
 * SSRF-hardened: only private / loopback / link-local targets.
 */
@Injectable()
export class PrinterService {
  async ping(host: string, port = DEFAULT_PORT): Promise<{ ok: true; latencyMs: number }> {
    const target = await this.resolveAllowedTarget(host, port);
    const started = Date.now();
    await this.withSocket(target.host, target.port, async (socket) => {
      // Successful TCP connect is enough for a health check.
      void socket;
    });
    return { ok: true, latencyMs: Date.now() - started };
  }

  async printRaw(input: NetworkPrinterInput): Promise<{ ok: true; bytes: number }> {
    const port = input.port ?? DEFAULT_PORT;
    const target = await this.resolveAllowedTarget(input.host, port);
    const bytes = this.decodePayload(input.dataBase64);
    await this.withSocket(target.host, target.port, async (socket) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new ServiceUnavailableException('Printer write timed out')),
          WRITE_TIMEOUT_MS,
        );
        socket.write(bytes, (err) => {
          clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        });
      });
    });
    return { ok: true, bytes: bytes.length };
  }

  private decodePayload(dataBase64: string): Buffer {
    if (!dataBase64 || typeof dataBase64 !== 'string') {
      throw new BadRequestException('dataBase64 is required');
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(dataBase64, 'base64');
    } catch {
      throw new BadRequestException('Invalid base64 payload');
    }
    if (buf.length < 1) {
      throw new BadRequestException('Empty print payload');
    }
    if (buf.length > MAX_PAYLOAD_BYTES) {
      throw new BadRequestException(`Print payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
    }
    return buf;
  }

  private async resolveAllowedTarget(
    hostRaw: string,
    portRaw: number,
  ): Promise<{ host: string; port: number }> {
    const host = (hostRaw ?? '').trim().toLowerCase();
    const port = Number(portRaw);
    if (!host || host.length > 253) {
      throw new BadRequestException('Invalid printer host');
    }
    if (host.includes('/') || host.includes('@') || host.includes('\\') || host.includes(':')) {
      // No URLs, credentials, IPv6 literals, or path tricks.
      throw new BadRequestException('Invalid printer host');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('Invalid printer port');
    }

    const ipVersion = isIP(host);
    if (ipVersion === 4) {
      if (!this.isPrivateOrLocalIpv4(host)) {
        throw new BadRequestException('Only private LAN printer addresses are allowed');
      }
      return { host, port };
    }
    if (ipVersion === 6) {
      throw new BadRequestException('IPv6 printer targets are not supported');
    }
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(host)) {
      throw new BadRequestException('Invalid printer hostname');
    }

    // Resolve hostname and require a private A record (blocks public SSRF).
    let address: string;
    try {
      const result = await lookup(host, { family: 4 });
      address = result.address;
    } catch {
      throw new BadRequestException('Unable to resolve printer host');
    }
    if (!this.isPrivateOrLocalIpv4(address)) {
      throw new BadRequestException('Printer host must resolve to a private LAN address');
    }
    return { host: address, port };
  }

  private isPrivateOrLocalIpv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return false;
    }
    const [a, b] = parts;
    if (a === 127) return true; // loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }

  private withSocket<T>(
    host: string,
    port: number,
    fn: (socket: Socket) => Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const socket = new Socket();
      let settled = false;

      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        const message =
          err instanceof Error ? err.message : 'Unable to reach network printer';
        reject(new ServiceUnavailableException(message));
      };

      const timer = setTimeout(
        () => fail(new Error('Printer connection timed out')),
        CONNECT_TIMEOUT_MS,
      );

      socket.once('error', fail);
      socket.connect(port, host, () => {
        clearTimeout(timer);
        void fn(socket)
          .then((value) => {
            if (settled) return;
            settled = true;
            socket.end(() => resolve(value));
          })
          .catch(fail);
      });
    });
  }
}
