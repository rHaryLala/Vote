import { Badge } from '@/components/ui/badge'
import type { Status } from '../api'

/** Statut d'un scrutin, avec la nuance « ouvert mais hors de la fenêtre de vote ». */
export function StatusBadge({ status, isOpen, published }: { status: Status; isOpen: boolean; published: boolean }) {
  if (status === 'draft') return <Badge variant="outline">Brouillon</Badge>
  if (status === 'closed') return <Badge variant="secondary">{published ? 'Clos · résultats publiés' : 'Clos'}</Badge>
  return isOpen ? (
    <Badge className="bg-success text-white">Vote en cours</Badge>
  ) : (
    <Badge variant="outline" className="border-primary text-primary">
      Ouvert · hors horaires
    </Badge>
  )
}
