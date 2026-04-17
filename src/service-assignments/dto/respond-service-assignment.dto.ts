import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class RespondServiceAssignmentDto {
  @IsString()
  @IsNotEmpty()
  @IsIn(['accepted', 'rejected'])
  status!: 'accepted' | 'rejected';
}
