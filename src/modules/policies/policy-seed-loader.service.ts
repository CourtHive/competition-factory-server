import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'node:crypto';
import { join } from 'path';

import {
  IPolicyStorage,
  POLICY_STORAGE,
  PolicyVisibility,
} from 'src/storage/interfaces/policy-storage.interface';
import { validatePolicyForSave } from './policy-validator';

interface PolicySeedFile {
  providerId: string | null;
  policyType: string;
  name: string;
  version: string;
  visibility: PolicyVisibility;
  definition: any;
  metadata?: any;
}

@Injectable()
export class PolicySeedLoader implements OnModuleInit {
  private readonly logger = new Logger(PolicySeedLoader.name);

  constructor(@Inject(POLICY_STORAGE) private readonly storage: IPolicyStorage) {}

  async onModuleInit(): Promise<void> {
    // Resolve against process.cwd() at boot time, not module load time —
    // tests need to be able to chdir into a temp directory before invoking
    // the loader. process.cwd() is the project root for both `nest start`
    // and `pnpm watch`.
    const seedsDir = join(process.cwd(), 'seeds', 'policies');

    if (!existsSync(seedsDir)) {
      this.logger.log(`No seeds/policies directory at ${seedsDir} — skipping seed load`);
      return;
    }

    const seedFiles = await this.discoverSeeds(seedsDir);
    if (!seedFiles.length) {
      this.logger.log('No policy seed files discovered');
      return;
    }

    let added = 0;
    let skipped = 0;
    let failed = 0;

    for (const filePath of seedFiles) {
      const outcome = await this.applySeed(filePath);
      if (outcome === 'added') added++;
      else if (outcome === 'skipped') skipped++;
      else failed++;
    }

    this.logger.log(`Policy seeds: ${added} added, ${skipped} already present, ${failed} failed`);
  }

  private async discoverSeeds(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.discoverSeeds(full);
        files.push(...nested);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(full);
      }
    }

    return files.sort();
  }

  private async applySeed(filePath: string): Promise<'added' | 'skipped' | 'failed'> {
    let seed: PolicySeedFile;
    try {
      const contents = await readFile(filePath, 'utf8');
      seed = JSON.parse(contents) as PolicySeedFile;
    } catch (err) {
      this.logger.error(`Failed to read seed ${filePath}: ${(err as Error).message}`);
      return 'failed';
    }

    const validation = validatePolicyForSave({
      policyType: seed.policyType,
      name: seed.name,
      version: seed.version,
      visibility: seed.visibility,
      definition: seed.definition,
    });

    if (!validation.ok) {
      this.logger.error(
        `Seed ${filePath} failed validation: ${validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
      );
      return 'failed';
    }

    const existing = await this.storage.getPolicy({
      policyType: seed.policyType,
      name: seed.name,
      version: seed.version,
      providerId: seed.providerId,
    });

    if (existing.policy) return 'skipped';

    try {
      const result = await this.storage.savePolicy({
        policyId: randomUUID(),
        providerId: seed.providerId,
        policyType: seed.policyType,
        name: seed.name,
        version: seed.version,
        visibility: seed.visibility,
        definition: seed.definition,
        metadata: seed.metadata,
        publishedBy: 'seed-loader',
      });
      if (result.error) {
        this.logger.warn(`Seed ${seed.policyType}/${seed.name}@${seed.version}: storage error ${result.error}`);
        return 'failed';
      }
      return 'added';
    } catch (err) {
      const message = (err as Error).message;
      // FK violation: provider_id references providers(provider_id). If the
      // provider row hasn't been provisioned yet, log and skip the seed
      // rather than failing the whole boot.
      if (/foreign key|provider_id/i.test(message)) {
        this.logger.warn(
          `Seed ${seed.name}@${seed.version} references missing provider ${seed.providerId} — skipping`,
        );
        return 'skipped';
      }
      this.logger.error(`Seed ${filePath} save failed: ${message}`);
      return 'failed';
    }
  }
}
