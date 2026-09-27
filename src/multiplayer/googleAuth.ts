import { OAuth2Client } from 'google-auth-library'
import { AppError } from './appStore'

export interface GoogleProfile {
  sub: string
  email: string
  name: string
}

export function googleClientId(): string | null {
  const value = process.env.GOOGLE_CLIENT_ID?.trim()
  return value || null
}

export async function verifyGoogleCredential(credential: string): Promise<GoogleProfile> {
  const clientId = googleClientId()
  if (!clientId) throw new AppError('Google sign-in is not configured.', 503)
  const token = credential.trim()
  if (!token) throw new AppError('Google sign-in did not return a credential.', 400)

  const client = new OAuth2Client(clientId)
  let payload
  try {
    const ticket = await client.verifyIdToken({ idToken: token, audience: clientId })
    payload = ticket.getPayload()
  } catch {
    throw new AppError('Google sign-in could not be verified.', 401)
  }
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new AppError('Google did not confirm this email.', 401)
  }
  return { sub: payload.sub, email: payload.email, name: payload.name ?? '' }
}
