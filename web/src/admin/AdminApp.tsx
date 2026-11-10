import { ExternalLink, FileText, LogOut, Menu, ShieldCheck, UserCog, Vote } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { adminApi, setAdminSession, useAdminSession } from './api'
import { AccountPage } from './pages/AccountPage'
import { AuditPage } from './pages/AuditPage'
import { ContentPage } from './pages/ContentPage'
import { ElectionPage } from './pages/ElectionPage'
import { ElectionsPage } from './pages/ElectionsPage'
import { LoginPage } from './pages/LoginPage'

const NAV = [
  { to: '/admin', label: 'Scrutins', icon: Vote, end: false, match: (p: string) => p === '/admin' || p.startsWith('/admin/scrutins') },
  { to: '/admin/contenu', label: 'Contenu des pages', icon: FileText, end: true },
  { to: '/admin/journal', label: "Journal d'audit", icon: ShieldCheck, end: true },
  { to: '/admin/compte', label: 'Mon compte', icon: UserCog, end: true },
]

async function logout() {
  try {
    await adminApi('/logout', { method: 'POST' })
  } catch {
    // Même hors ligne, la session locale est effacée.
  }
  setAdminSession(null)
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation()
  return (
    <nav className="grid gap-1" aria-label="Administration">
      {NAV.map(({ to, label, icon: Icon, end, match }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              (match ? match(pathname) : isActive)
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )
          }
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function Layout({ children }: { children: ReactNode }) {
  const session = useAdminSession()!

  return (
    <div className="flex min-h-dvh">
      {/* Barre latérale (ordinateur) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r bg-muted/40 p-4 md:flex">
        <Link to="/admin" className="mb-6 flex items-center gap-3 px-2">
          <img src="/brand/sa-mark.svg" alt="" className="h-8 w-auto" />
          <div className="leading-tight">
            <div className="text-sm font-semibold">Vote SA</div>
            <div className="text-xs text-muted-foreground">Commission électorale</div>
          </div>
        </Link>
        <NavLinks />
        <div className="mt-auto grid gap-2">
          <Button variant="ghost" className="justify-start" asChild>
            <a href="/" target="_blank" rel="noreferrer">
              <ExternalLink /> Voir le site
            </a>
          </Button>
          <div className="rounded-md border bg-background p-3">
            <div className="truncate text-sm font-medium">{session.user.name}</div>
            <div className="truncate text-xs text-muted-foreground">{session.user.email}</div>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void logout()}>
              <LogOut /> Se déconnecter
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre du haut (mobile) */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur md:hidden">
          <Link to="/admin" className="flex items-center gap-2">
            <img src="/brand/sa-mark.svg" alt="" className="h-7 w-auto" />
            <span className="text-sm font-semibold">Commission</span>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Menu">
                <Menu />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{session.user.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {NAV.map(({ to, label, icon: Icon }) => (
                <DropdownMenuItem key={to} asChild>
                  <Link to={to}>
                    <Icon /> {label}
                  </Link>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a href="/" target="_blank" rel="noreferrer">
                  <ExternalLink /> Voir le site
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut /> Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  )
}

/** Administration (commission électorale), chargée à part : les électeurs ne téléchargent jamais ce code. */
export default function AdminApp() {
  const session = useAdminSession()

  return (
    <div className="admin-root min-h-dvh">
      <TooltipProvider>
        {session ? (
          <Layout>
            <Routes>
              <Route index element={<ElectionsPage />} />
              <Route path="scrutins/nouveau" element={<ElectionPage />} />
              <Route path="scrutins/:id" element={<ElectionPage />} />
              <Route path="contenu" element={<ContentPage />} />
              <Route path="journal" element={<AuditPage />} />
              <Route path="compte" element={<AccountPage />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </Layout>
        ) : (
          <LoginPage />
        )}
        <Toaster richColors position="top-right" />
      </TooltipProvider>
    </div>
  )
}
