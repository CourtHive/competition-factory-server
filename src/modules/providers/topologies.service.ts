import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

import {
  TOPOLOGY_STORAGE,
  type ITopologyStorage,
  type TopologyRow,
} from 'src/storage/interfaces/topology-storage.interface';
import { SUCCESS } from 'src/common/constants/app';

export interface TopologyDto {
  topologyId: string;
  name: string;
  description?: string | null;
  state: any;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(row: TopologyRow): TopologyDto {
  return {
    topologyId: row.topologyId,
    name: row.name,
    description: row.description,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class TopologiesService {
  constructor(
    @Inject(TOPOLOGY_STORAGE) private readonly topologyStorage: ITopologyStorage,
  ) {}

  async listForProvider(providerId: string): Promise<{ topologies: TopologyDto[] }> {
    const rows = await this.topologyStorage.findByProvider(providerId);
    return { topologies: rows.map(toDto) };
  }

  async getOne(providerId: string, topologyId: string): Promise<TopologyDto> {
    const row = await this.topologyStorage.getOne(providerId, topologyId);
    if (!row) throw new NotFoundException('Topology not found');
    return toDto(row);
  }

  async create(
    providerId: string,
    body: { name: string; description?: string; state: any },
  ): Promise<TopologyDto> {
    const row = await this.topologyStorage.create({
      topologyId: randomUUID(),
      providerId,
      name: body.name,
      description: body.description ?? null,
      state: body.state,
    });
    return toDto(row);
  }

  async update(
    providerId: string,
    topologyId: string,
    patch: { name?: string; description?: string; state?: any },
  ) {
    const existing = await this.topologyStorage.getOne(providerId, topologyId);
    if (!existing) throw new NotFoundException('Topology not found');
    await this.topologyStorage.update(providerId, topologyId, patch);
    const updated = await this.topologyStorage.getOne(providerId, topologyId);
    return { ...SUCCESS, topology: updated ? toDto(updated) : null };
  }

  async remove(providerId: string, topologyId: string) {
    return this.topologyStorage.remove(providerId, topologyId);
  }
}
