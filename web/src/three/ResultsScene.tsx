import { ContactShadows, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

interface Props {
  /** Parts de chaque choix, entre 0 et 1. */
  yes: number
  no: number
  blank: number
}

const MAX_HEIGHT = 2.6
const BARS = [
  { key: 'yes', x: -1.7, color: '#28476a', glow: true },
  { key: 'no', x: 0, color: '#1c1c1c', glow: false },
  { key: 'blank', x: 1.7, color: '#bdbdb9', glow: false },
] as const

function Bar({ x, color, glow, target }: { x: number; color: string; glow: boolean; target: number }) {
  const group = useRef<THREE.Group>(null)
  const height = useRef(0.001)

  // Les barres montent en douceur jusqu'à leur hauteur.
  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    height.current = THREE.MathUtils.damp(height.current, Math.max(target * MAX_HEIGHT, 0.04), 2.2, dt)
    g.scale.y = height.current
    g.position.y = height.current / 2
  })

  return (
    <group ref={group} position={[x, 0, 0]} scale={[1, 0.001, 1]}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color={color}
          roughness={0.4}
          emissive={glow ? color : '#000000'}
          emissiveIntensity={glow ? 0.5 : 0}
        />
      </mesh>
    </group>
  )
}

function Rig() {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    camera.lookAt(0, 1.1, 0)
  }, [camera])
  useFrame((state) => {
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, state.pointer.x * 1.2, 0.04)
    camera.lookAt(0, 1.1, 0)
  })
  return null
}

export default function ResultsScene({ yes, no, blank }: Props) {
  const values = { yes, no, blank }
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 3, 7.6], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 6, 4]} intensity={2.2} />
      <directionalLight position={[-4, 2, 2]} intensity={0.5} />
      <RoundedBox args={[5.6, 0.12, 2.2]} radius={0.05} smoothness={3} position={[0, -0.06, 0]}>
        <meshPhysicalMaterial color="#f4f4f2" roughness={0.45} clearcoat={0.4} />
      </RoundedBox>
      {BARS.map((b) => (
        <Bar key={b.key} x={b.x} color={b.color} glow={b.glow} target={values[b.key]} />
      ))}
      <ContactShadows position={[0, -0.13, 0]} opacity={0.3} scale={9} blur={2.4} far={3} />
      <Rig />
    </Canvas>
  )
}
