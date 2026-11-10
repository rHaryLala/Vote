import { ContactShadows, Float, RoundedBox } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { useSaMarkGeometry } from './saMark'

// Lueur : bleu de la SA éclairci, pour qu'il « brille » sur l'écran sombre.
const GLOW = '#4a86d4'

/**
 * Tuile « SA » : un objet en plastique blanc, écran sombre cerclé de bleu lumineux et monogramme en relief,
 * dans l'esprit du robot de la référence. Elle s'incline vers le pointeur.
 */
function SaTile() {
  const group = useRef<THREE.Group>(null)
  const glow = useRef<THREE.MeshStandardMaterial>(null)
  const mark = useSaMarkGeometry(1.45, 0.12)

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, Math.sin(t * 0.4) * 0.35 + state.pointer.x * 0.45, 0.06)
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, -0.08 - state.pointer.y * 0.3, 0.06)
    if (glow.current) glow.current.emissiveIntensity = 2.2 + Math.sin(t * 2) * 0.35 // l'anneau « respire »
  })

  return (
    <group ref={group}>
      {/* Corps en plastique blanc */}
      <RoundedBox args={[2.5, 2.5, 0.7]} radius={0.28} smoothness={6}>
        <meshPhysicalMaterial color="#f4f4f2" roughness={0.38} clearcoat={0.6} clearcoatRoughness={0.4} />
      </RoundedBox>
      {/* Anneau bleu lumineux */}
      <RoundedBox args={[2.12, 2.12, 0.1]} radius={0.18} smoothness={4} position={[0, 0, 0.33]}>
        <meshStandardMaterial ref={glow} color={GLOW} emissive={GLOW} emissiveIntensity={2.2} toneMapped={false} />
      </RoundedBox>
      {/* Écran sombre */}
      <RoundedBox args={[1.9, 1.9, 0.1]} radius={0.12} smoothness={4} position={[0, 0, 0.37]}>
        <meshStandardMaterial color="#161616" roughness={0.25} metalness={0.2} />
      </RoundedBox>
      {/* Monogramme SA en relief, légèrement lumineux */}
      <mesh geometry={mark} position={[0, 0.02, 0.48]}>
        <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.25} roughness={0.4} />
      </mesh>
    </group>
  )
}

export default function HeroScene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.2, 6.2], fov: 36 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 5, 5]} intensity={2.2} />
      <directionalLight position={[-4, 2, 2]} intensity={0.6} />
      <pointLight position={[0, 0, 2.2]} intensity={6} color={GLOW} distance={4} />
      <Float speed={1.3} rotationIntensity={0.1} floatIntensity={0.6}>
        <SaTile />
      </Float>
      <ContactShadows position={[0, -1.75, 0]} opacity={0.35} scale={7} blur={2.6} far={3} />
    </Canvas>
  )
}
