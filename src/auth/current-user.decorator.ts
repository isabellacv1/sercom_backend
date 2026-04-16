import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

type JwtUser = {
  sub: string;
  email?: string;
  role?: string;
};

type AuthRequest = Request & {
  user?: JwtUser;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthRequest>();
    return request.user;
  },
);
