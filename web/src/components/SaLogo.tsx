/**
 * Logo de la SA, vectorisé depuis le logo officiel (fond transparent, net à toutes les tailles).
 * - variant « full » : monogramme + « STUDENT ASSOCIATION »
 * - variant « mark » : monogramme seul (en-tête, petites tailles)
 */
export function SaLogo({ variant = 'full', className = 'h-20 w-auto' }: { variant?: 'full' | 'mark'; className?: string }) {
  return (
    <img
      src={variant === 'full' ? '/brand/sa-logo.svg' : '/brand/sa-mark.svg'}
      alt={variant === 'full' ? 'Student Association' : 'SA'}
      className={`${className} select-none object-contain`}
      draggable={false}
    />
  )
}
