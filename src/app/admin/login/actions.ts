'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
} from '@/lib/auth/admin-session'

export type LoginFormState = { error?: string } | null

export async function loginAction(
  _prev: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const password = String(formData.get('password') ?? '')
  const expected = process.env.ADMIN_PASSWORD
  const secret = process.env.ADMIN_SESSION_SECRET

  if (!expected || !secret) {
    return { error: 'Admin login is not configured (missing env vars).' }
  }
  if (password !== expected) {
    return { error: 'Invalid password.' }
  }

  const token = await createAdminSessionToken(secret, 60 * 60 * 24 * 7)
  const jar = await cookies()
  jar.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })

  redirect('/admin')
}

export async function logoutAction() {
  const jar = await cookies()
  jar.delete(ADMIN_SESSION_COOKIE)
  redirect('/admin/login')
}
