import { SetMetadata } from '@nestjs/common'
import { type ZodType } from 'zod'

export const ZOD_RESPONSE_SCHEMA = Symbol('ZOD_RESPONSE_SCHEMA')

export function ZodResponse(schema: ZodType): MethodDecorator {
  return SetMetadata(ZOD_RESPONSE_SCHEMA, schema)
}
