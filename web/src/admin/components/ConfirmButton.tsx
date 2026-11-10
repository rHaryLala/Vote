import { Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

/** Bouton d'action sensible : fenêtre de confirmation shadcn avant d'exécuter. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel,
  onConfirm,
  variant = 'default',
  disabled = false,
  size = 'default',
  ariaLabel,
}: {
  children: ReactNode
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => Promise<unknown>
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost'
  disabled?: boolean
  size?: 'default' | 'sm' | 'icon-sm'
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled} aria-label={ariaLabel}>
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={variant === 'destructive' ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await onConfirm()
                setOpen(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
