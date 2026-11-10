// Génère les icônes de la PWA : monogramme SA (vectoriel) centré sur le gris clair de la charte.
import sharp from 'sharp'

const PAPER = '#e8e8e6'
const src = 'public/brand/sa-mark.svg'

async function icon(size, file, ratio = 0.62) {
  const inner = Math.round(size * ratio)
  const mark = await sharp(src, { density: 300 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  await sharp({ create: { width: size, height: size, channels: 4, background: PAPER } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toFile(`public/${file}`)
}

await icon(192, 'icon-192.png')
await icon(512, 'icon-512.png') // « maskable » : le monogramme reste dans la zone de sécurité (62 %)
await icon(180, 'apple-touch-icon.png', 0.7)
await icon(64, 'favicon.png', 0.82)
console.log('icônes générées')
