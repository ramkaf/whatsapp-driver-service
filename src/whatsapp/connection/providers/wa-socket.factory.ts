import { Injectable } from '@nestjs/common';
import { makeWASocket, useMultiFileAuthState } from 'baileys';

import { mkdir, chmod, rename } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appConfiguration } from '#common';
import { CreatedWaSocket } from '../interfaces/wa-socket-factorty.interface.ts';
import { JsonlService } from '../../messages/core/providers/jsonl.service.ts';

@Injectable()
export class WhatsappSocketFactory {
  private generation = 0;
  private readonly pendingWrites = new Set<Promise<unknown>>();

  constructor(private readonly jsonlService: JsonlService) {}

  async archiveSession(): Promise<void> {
    const authDir = resolve(
      appConfiguration().whatsapp.authDir || '.data/whatsapp-auth',
    );
    const workspaceFromAuth = relative(authDir, process.cwd());
    if (
      !workspaceFromAuth ||
      (!workspaceFromAuth.startsWith('..') && !isAbsolute(workspaceFromAuth))
    ) {
      throw new Error(
        'WhatsApp auth directory must not contain the application directory',
      );
    }

    // Retire old callbacks before draining writes, including Signal key writes.
    this.generation++;
    await Promise.allSettled(this.pendingWrites);
    const archive = `${authDir}.archive-${Date.now()}-${randomUUID()}`;
    try {
      await rename(authDir, archive);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async write<T>(
    generation: number,
    operation: () => Promise<T>,
  ): Promise<T | undefined> {
    if (generation !== this.generation) return;
    const pending = Promise.resolve().then(operation);
    this.pendingWrites.add(pending);
    try {
      return await pending;
    } finally {
      this.pendingWrites.delete(pending);
    }
  }

  async create(): Promise<CreatedWaSocket> {
    const authPath =
      appConfiguration().whatsapp.authDir || '.data/whatsapp-auth';

    const authDir = resolve(authPath);

    await mkdir(authDir, {
      recursive: true,
      mode: 0o700,
    });

    await chmod(authDir, 0o700);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const generation = this.generation;
    const setKeys = state.keys.set.bind(state.keys);
    state.keys.set = async (data) => {
      await this.write(generation, async () => {
        await setKeys(data);
      });
    };

    const socket = makeWASocket({
      auth: state,
      markOnlineOnConnect: false,
      syncFullHistory: true,
      getMessage: (key) => this.jsonlService.getMessage(key),
    });
    socket.ev.on('creds.update', async () => {
  await saveCreds();
});
    return {
      socket,
      saveCreds: async () => {
        await this.write(generation, saveCreds);
      },
      hasSavedSession: Boolean(state.creds?.me),
    };
  }
}
