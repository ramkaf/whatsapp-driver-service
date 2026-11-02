import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Auth } from '../../../libs/common/document/authentication.decorator.ts';
import { ApiTags } from '@nestjs/swagger';
import { WhatsappGroupService } from './../providers/whatsapp-group.service.ts';
import { WhatsappConnectionGuard } from '../../connection/guards/whatsapp-connection.guard.ts';
import { ApiOperationWithDocs } from '../../../libs/common/document/common-swagger.decorator.ts';
import {
  CreateGroupDto,
  UpdateGroupSubjectDto,
  UpdateGroupDescriptionDto,
  GroupParticipantsDto,
  GroupParticipantRoleDto,
  JoinGroupDto,
  GroupJidParamDto,
} from './../dto/index.ts';

@Auth()
@ApiTags('whatsapp groups api')
@UseGuards(WhatsappConnectionGuard)
@Controller('whatsapp/groups')
export class WhatsappGroupController {
  constructor(private readonly whatsappGroupsService: WhatsappGroupService) {}

  @Get()
  @ApiOperationWithDocs('Get all joined WhatsApp groups')
  findAll() {
    return this.whatsappGroupsService.findAll();
  }

  @Post()
  @ApiOperationWithDocs('Create WhatsApp group')
  create(@Body() dto: CreateGroupDto) {
    return this.whatsappGroupsService.create(dto.subject, dto.participants);
  }

  @Post('join')
  @ApiOperationWithDocs('Join group using invite code')
  join(@Body() dto: JoinGroupDto) {
    return this.whatsappGroupsService.joinByInvite(dto.code);
  }

  @Get(':groupJid')
  @ApiOperationWithDocs('Get WhatsApp group details')
  findOne(@Param() groupJidDto: GroupJidParamDto) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.findOne(groupJid);
  }

  @Get(':groupJid/participants')
  @ApiOperationWithDocs('Get group participants')
  getParticipants(@Param() groupJidDto: GroupJidParamDto) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.getParticipants(groupJid);
  }

  @Get(':groupJid/info')
  @ApiOperationWithDocs('Get group information and participant details')
  getInfo(@Param() groupJidDto: GroupJidParamDto) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.getInfo(groupJid);
  }

  @Patch(':groupJid/subject')
  @ApiOperationWithDocs('Update group subject')
  updateSubject(
    @Param() groupJidDto: GroupJidParamDto,
    @Body() dto: UpdateGroupSubjectDto,
  ) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.updateSubject(groupJid, dto.subject);
  }

  @Patch(':groupJid/description')
  @ApiOperationWithDocs('Update group description')
  updateDescription(
    @Param() groupJidDto: GroupJidParamDto,
    @Body() dto: UpdateGroupDescriptionDto,
  ) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.updateDescription(
      groupJid,
      dto.description,
    );
  }

  @Post(':groupJid/participants')
  @ApiOperationWithDocs('Add group participants')
  addParticipants(
    @Param() groupJidDto: GroupJidParamDto,
    @Body() dto: GroupParticipantsDto,
  ) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.addParticipants(
      groupJid,
      dto.participants,
    );
  }

  @Delete(':groupJid/participants')
  @ApiOperationWithDocs('Remove group participants')
  removeParticipants(
    @Param() groupJidDto: GroupJidParamDto,
    @Body() dto: GroupParticipantsDto,
  ) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.removeParticipants(
      groupJid,
      dto.participants,
    );
  }

  @Patch(':groupJid/participants/role')
  @ApiOperationWithDocs('Promote or demote participants')
  changeParticipantRole(
    @Param() groupJidDto: GroupJidParamDto,
    @Body() dto: GroupParticipantRoleDto,
  ) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.changeParticipantRole(
      groupJid,
      dto.participants,
      dto.action,
    );
  }

  @Get(':groupJid/invite')
  @ApiOperationWithDocs('Get group invite code')
  getInviteCode(@Param() groupJidDto: GroupJidParamDto) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.getInviteCode(groupJid);
  }

  @Post(':groupJid/invite/revoke')
  @ApiOperationWithDocs('Revoke group invite code')
  revokeInviteCode(@Param() groupJidDto: GroupJidParamDto) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.revokeInviteCode(groupJid);
  }

  @Post(':groupJid/leave')
  @ApiOperationWithDocs('Leave WhatsApp group')
  leave(@Param() groupJidDto: GroupJidParamDto) {
    const { groupJid } = groupJidDto;
    return this.whatsappGroupsService.leave(groupJid);
  }
}
