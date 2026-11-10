import { Global, Module } from '@nestjs/common';

 

@Global()
@Module({
  imports: [],
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
