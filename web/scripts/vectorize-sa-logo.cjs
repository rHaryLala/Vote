// Vectorise le logo de la SA (JPEG 1024 px sur fond gris de « tuile d'application ») en SVG net, fond transparent.
// Usage : node scripts/vectorize-sa-logo.cjs <logo.jpg> [chemin/vers/potrace]
// Le module potrace n'est pas une dépendance du projet : on réutilise celui de uaz-website par défaut.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const SRC = process.argv[2]
const POTRACE = process.argv[3] || 'C:/laragon/www/uaz-website/node_modules/potrace'
const potrace = require(POTRACE)
const OUT = path.join(__dirname, '..', 'public', 'brand')
const NAVY = '#28476A' // couleur moyenne mesurée sur les lettres

const trace = (buf, opts) =>
  new Promise((res, rej) => potrace.trace(buf, opts, (err, svg) => (err ? rej(err) : res(svg))))

/**
 * Masque « logo » : un pixel appartient au logo à proportion de sa teinte bleue (b − r).
 * Le fond et le contour gris de la tuile sont neutres (b ≈ r) et disparaissent ; les bords anticrénelés
 * gardent une valeur intermédiaire, ce qui donne des contours lisses après agrandissement.
 */
async function mask(region) {
  const img = sharp(SRC).removeAlpha()
  const src = region ? img.extract(region) : img
  const { data, info } = await src.raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.alloc(info.width * info.height)
  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    const t = Math.max(0, Math.min(1, (data[i + 2] - data[i]) / 55))
    out[p] = Math.round(255 * (1 - t)) // noir = logo
  }
  // Agrandissement ×3 avec lissage : potrace trace alors des courbes propres au lieu des marches de pixels.
  // Médiane : retire le bruit de compression JPEG ; agrandissement ×3 puis flou : courbes lisses au tracé.
  const clean = await sharp(out, { raw: { width: info.width, height: info.height, channels: 1 } }).median(3).png().toBuffer()
  return sharp(clean)
    .resize(info.width * 3, info.height * 3, { kernel: 'lanczos3' })
    .blur(3)
    .png()
    .toBuffer()
}

/** Recadre le viewBox du SVG potrace sur le contenu réel. */
async function tightSvg(svg) {
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const trimmed = await sharp(png).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true })
  const { trimOffsetLeft: x, trimOffsetTop: y, width: w, height: h } = trimmed.info
  const pad = Math.round(Math.max(w, h) * 0.02)
  return svg
    .replace(/<svg[^>]*>/, (tag) =>
      tag
        .replace(/width="[^"]*"/, '')
        .replace(/height="[^"]*"/, '')
        .replace(/viewBox="[^"]*"/, '')
        .replace('<svg', `<svg viewBox="${-x - pad} ${-y - pad} ${w + 2 * pad} ${h + 2 * pad}"`),
    )
    .replace(/<rect[^>]*\/>/, '') // potrace peut ajouter un fond : on le retire (transparence)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const opts = { threshold: 128, turdSize: 120, optTolerance: 0.5, color: NAVY, background: 'transparent' }

  // 1. Logo complet (lettres + « STUDENT ASSOCIATION »)
  const full = await tightSvg(await trace(await mask({ left: 140, top: 120, width: 744, height: 780 }), opts))
  fs.writeFileSync(path.join(OUT, 'sa-logo.svg'), full)

  // 2. Monogramme seul (lettres « SA »), pour la 3D et les petites tailles
  const mark = await tightSvg(await trace(await mask({ left: 150, top: 130, width: 724, height: 570 }), opts))
  fs.writeFileSync(path.join(OUT, 'sa-mark.svg'), mark)

  // 3. PNG haute définition à fond transparent (2048 px), pour les usages hors web
  // Le viewBox est déjà en unités ×3 (≈ 3000 px) : la densité par défaut suffit pour un rendu net en 2048 px.
  await sharp(Buffer.from(full))
    .resize(2048, 2048, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, 'sa-logo.png'))

  for (const f of ['sa-logo.svg', 'sa-mark.svg', 'sa-logo.png']) {
    console.log(f.padEnd(14), fs.statSync(path.join(OUT, f)).size, 'octets')
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
