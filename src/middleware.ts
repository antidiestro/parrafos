import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from '@/lib/auth/admin-session'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return NextResponse.next()
  }

  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) {
    return NextResponse.redirect(new URL('/admin/login', request.url))
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value
  if (!(await verifyAdminSessionToken(secret, token))) {
    return NextResponse.redirect(new URL('/admin/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
