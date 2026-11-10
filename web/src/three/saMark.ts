import { useMemo } from 'react'
import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import markSvg from '../../public/brand/sa-mark.svg?raw'

/**
 * Le monogramme « SA » (vectorisé depuis le logo officiel) extrudé en volume.
 * La géométrie est centrée et mise à l'échelle pour mesurer `width` unités de large.
 */
export function useSaMarkGeometry(width: number, depth = 0.18): THREE.ExtrudeGeometry {
  return useMemo(() => {
    const data = new SVGLoader().parse(markSvg)
    const shapes = data.paths.flatMap((p) => SVGLoader.createShapes(p))
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth: 1,
      bevelEnabled: false,
      curveSegments: 5,
    })
    geo.computeBoundingBox()
    const box = geo.boundingBox!
    const size = new THREE.Vector3()
    box.getSize(size)
    const s = width / size.x
    // Le SVG a l'axe Y vers le bas : on le retourne. Une seule échelle négative inverserait l'orientation des
    // faces (la face avant serait masquée) : on retourne donc aussi Z, ce qui rétablit l'orientation.
    geo.center()
    geo.scale(s, -s, -depth)
    geo.computeVertexNormals()
    return geo
  }, [width, depth])
}
