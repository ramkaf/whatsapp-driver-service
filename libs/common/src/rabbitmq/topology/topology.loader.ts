import { readFile } from 'node:fs/promises';
import type { Topology } from '../common/interface/topology.interface.ts';
import { RabbitMQError } from '../common/error/rabbitmq.error.ts';
import { normalize } from './topology.validation.ts';

export async function readTopology(path: string): Promise<Required<Topology>> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause) {
    throw new RabbitMQError(
      'TOPOLOGY_READ_FAILED',
      `Cannot read topology file: ${path}`,
      { cause },
    );
  }
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (cause) {
    throw new RabbitMQError(
      'INVALID_TOPOLOGY',
      `Invalid JSON in topology file: ${path}`,
      { cause },
    );
  }
  return normalize(data);
}
