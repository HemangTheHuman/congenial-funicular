'use client'

import { useActionState } from 'react'
import { loginAction, registerAction, type AuthFormState } from '@/app/actions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

export default function LoginPage() {
  const [loginState, loginFormAction, loginPending] = useActionState<AuthFormState, FormData>(
    loginAction,
    undefined
  )
  const [registerState, registerFormAction, registerPending] = useActionState<AuthFormState, FormData>(
    registerAction,
    undefined
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Kaithi Labeling</h1>
          <p className="text-muted-foreground text-sm">
            OCR dataset annotation and review platform
          </p>
        </div>

        <Card>
          <Tabs defaultValue="login">
            <CardHeader className="pb-0">
              <TabsList className="w-full">
                <TabsTrigger value="login" className="flex-1">Sign In</TabsTrigger>
                <TabsTrigger value="register" className="flex-1">Create Account</TabsTrigger>
              </TabsList>
            </CardHeader>

            {/* ── Login Tab ── */}
            <TabsContent value="login">
              <form action={loginFormAction}>
                <CardContent className="space-y-4 pt-4">
                  {loginState?.error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{loginState.error}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input
                      id="login-password"
                      name="password"
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loginPending}>
                    {loginPending ? 'Signing in…' : 'Sign In'}
                  </Button>
                </CardContent>
              </form>
            </TabsContent>

            {/* ── Register Tab ── */}
            <TabsContent value="register">
              <form action={registerFormAction}>
                <CardContent className="space-y-4 pt-4">
                  {registerState?.error && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{registerState.error}</AlertDescription>
                    </Alert>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="register-name">Full Name</Label>
                    <Input
                      id="register-name"
                      name="name"
                      type="text"
                      placeholder="Your name"
                      autoComplete="name"
                      required
                    />
                    {registerState?.fieldErrors?.name && (
                      <p className="text-xs text-destructive">{registerState.fieldErrors.name}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">Email</Label>
                    <Input
                      id="register-email"
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      required
                    />
                    {registerState?.fieldErrors?.email && (
                      <p className="text-xs text-destructive">{registerState.fieldErrors.email}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password">Password</Label>
                    <Input
                      id="register-password"
                      name="password"
                      type="password"
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      required
                    />
                    {registerState?.fieldErrors?.password && (
                      <p className="text-xs text-destructive">{registerState.fieldErrors.password}</p>
                    )}
                  </div>
                  <Button type="submit" className="w-full" disabled={registerPending}>
                    {registerPending ? 'Creating account…' : 'Create Account'}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground">
                    New accounts require admin approval before access is granted.
                  </p>
                </CardContent>
              </form>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  )
}
