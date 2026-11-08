import { SessionQueue } from '../session-queue.ts';

describe('SessionQueue', () => {
  it('serializes the same session while allowing other sessions to proceed after failures', async () => {
    const queue = new SessionQueue();
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run('one', async () => {
      calls.push('first');
      await gate;
      throw new Error('failure');
    });
    const rejected = expect(first).rejects.toThrow('failure');
    const second = queue.run('one', async () => {
      calls.push('second');
      return 2;
    });
    await queue.run('two', async () => {
      calls.push('independent');
    });
    expect(calls).toEqual(['first', 'independent']);
    release();
    await rejected;
    await expect(second).resolves.toBe(2);
    await queue.drain();
    expect(calls).toEqual(['first', 'independent', 'second']);
  });
});
