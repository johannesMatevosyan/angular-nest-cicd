import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  test: string = 'test';
  getData(): { message: string } {
    return { message: 'Hello API' };
  }
}
