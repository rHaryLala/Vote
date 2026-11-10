import { Block } from '../components/site'
import { useContent } from '../lib/content'

export function PrivacyPage() {
  const t = useContent()
  const sections = t.items('privacy', 'sections')

  return (
    <Block eyebrow={t.text('privacy', 'eyebrow')} title={t.text('privacy', 'title')}>
      <div className="mt-6 grid gap-px border-t border-line bg-line md:grid-cols-2">
        {sections.map((s, i) => (
          <article key={i} className="bg-paper p-4 md:p-6">
            <h2 className="label flex items-center gap-2 text-ink">
              <span className="marker" aria-hidden="true" />
              {s.title}
            </h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed text-dim">{s.text}</p>
          </article>
        ))}
      </div>
    </Block>
  )
}
