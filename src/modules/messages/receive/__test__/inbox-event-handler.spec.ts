import type { Prisma } from '@database/client.js';
import type { InboxService } from '../../../inbox/providers/inbox.service.ts';
import { ContactsUpdateEventHandler } from '../events/contacts-update.event.ts';

class FilteredContactsHandler extends ContactsUpdateEventHandler {
  readonly accept = vi
    .fn<(payload: Prisma.InputJsonValue) => boolean>()
    .mockReturnValue(true);
  readonly normalize = vi.fn((payload: Prisma.InputJsonValue) => payload);

  protected override shouldHandle(payload: Prisma.InputJsonValue): boolean {
    return this.accept(payload);
  }

  protected override normalizePayload(
    payload: Prisma.InputJsonValue,
  ): Prisma.InputJsonValue {
    return this.normalize(payload);
  }
}

it('filters individual items before normalization and inbox writes while continuing the batch', async () => {
  const handle = vi.fn().mockResolvedValue(undefined);
  const handler = new FilteredContactsHandler({
    handle,
  } as unknown as InboxService);
  const rejected = { id: 'rejected@s.whatsapp.net' };
  const accepted = { id: 'accepted@s.whatsapp.net' };
  handler.accept.mockReturnValueOnce(false);
  handler.normalize.mockReturnValueOnce({ contactId: 'normalized-id' });

  await handler.handle({
    event: 'contacts.update',
    sessionId: 'account-one',
    at: '',
    data: [rejected, accepted],
  });

  expect(handler.accept.mock.calls).toEqual([[rejected], [accepted]]);
  expect(handler.normalize).toHaveBeenCalledExactlyOnceWith(accepted);
  expect(handle).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      event: 'contacts.update',
      sessionId: 'account-one',
      payload: accepted,
      reformPayload: { contactId: 'normalized-id' },
    }),
  );
});
