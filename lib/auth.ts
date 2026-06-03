import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/db"
import bcrypt from "bcryptjs"
import type { DefaultSession } from "next-auth"

// Extend the built-in session type
declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: string
      /** Prime contractor identity surfaced in SOWs and emails. */
      organization?: string | null
      title?: string | null
      phone?: string | null
    } & DefaultSession["user"]
    /** Google OAuth access token — available when user signed in with Google */
    googleAccessToken?: string
    googleRefreshToken?: string
  }

  interface User {
    role: string
    organization?: string | null
    title?: string | null
    phone?: string | null
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    // Email/Password Authentication
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string }
        })

        if (!user || !user.password) {
          return null
        }

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        )

        if (!isValid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organization: user.organization,
          title: user.title,
          phone: user.phone,
        }
      }
    }),

    // Google OAuth — Gmail scopes for sending + thread sync
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.modify',
          ].join(' '),
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    })
  ],

  session: {
    strategy: "jwt"
  },

  callbacks: {
    async jwt({ token, user, account, trigger }) {
      if (user) {
        token.id = user.id
        token.role = user.role
        token.organization = user.organization ?? null
        token.title = user.title ?? null
        token.phone = user.phone ?? null
      }
      // Capture Google OAuth tokens on first sign-in
      if (account?.provider === 'google') {
        token.googleAccessToken = account.access_token
        token.googleRefreshToken = account.refresh_token
      }
      // Re-fetch identity fields when the user updates their profile —
      // /api/auth/session?update=1 triggers this. Without it, edits to
      // organization/title don't reach the JWT until the user re-signs in.
      if (trigger === 'update' && token.id) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { name: true, organization: true, title: true, phone: true },
        })
        if (fresh) {
          token.name = fresh.name
          token.organization = fresh.organization
          token.title = fresh.title
          token.phone = fresh.phone
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
        session.user.organization = (token.organization as string | null) ?? null
        session.user.title = (token.title as string | null) ?? null
        session.user.phone = (token.phone as string | null) ?? null
      }
      // Expose tokens to server-side code via session
      if (token.googleAccessToken) {
        session.googleAccessToken = token.googleAccessToken as string
      }
      if (token.googleRefreshToken) {
        session.googleRefreshToken = token.googleRefreshToken as string
      }
      return session
    }
  },

  pages: {
    signIn: "/login",
    error: "/auth/error"
  }
})
