import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common'
import { type ZodType } from 'zod'

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value)
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: '请求参数无效',
        details: result.error.flatten(),
      })
    }
    return result.data
  }
}
