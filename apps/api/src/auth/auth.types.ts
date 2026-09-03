import { type Request } from 'express'
import {
  type UserAccount,
  type UserSession,
} from '../generated/prisma/client.js'

export type AuthenticatedRequest = Request & {
  auth: { user: UserAccount; session: UserSession }
}
