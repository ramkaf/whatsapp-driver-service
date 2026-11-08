import { Global, Module } from '@nestjs/common';

import { PrismaModule } from '../prisma.module.ts';
 

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ 
    //It is sample
    // InboxEventRepository,
    // { provide: INBOX_EVENT_REPOSITORY, useExisting: InboxEventRepository }, 
  ],
  exports: [
    // INBOX_EVENT_REPOSITORY,
  ],
})
export class RepositoriesModule {}
