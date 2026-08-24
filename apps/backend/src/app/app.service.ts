import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  test = 'test';
  getData(): { message: string } {
    return { message: 'Hello API' };
  }
}
