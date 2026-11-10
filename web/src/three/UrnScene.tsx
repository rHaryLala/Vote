import { ContactShadows, RoundedBox, Sparkles } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import gsap from 'gsap'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useSaMarkGeometry } from './saMark'

const SA_BLUE = '#28476a'
const GLOW = '#4a86d4'

interface Props {
  /** « drop » : le bulletin tombe dans l'urne ; « done » : l'urne seule, déjà scellée. */
  phase: 'drop' | 'done'
}

function Urn({ phase }: Props) {
  const urn = useRef<THREE.Group>(null)
  const ballot = useRef<THREE.Group>(null)
  const [celebrate, setCelebrate] = useState(phase === 'done')
  const mark = useSaMarkGeometry(0.8, 0.05)

  // Le bulletin descend, marque une pause au-dessus de la fente, puis s'engouffre ; l'urne « encaisse ».
  useEffect(() => {
    if (phase === 'done' || !ballot.current || !urn.current) return
    const b = ballot.current
    const u = urn.current
    b.position.y = 3
    b.visible = true
    const tl = gsap
      .timeline({ delay: 0.5 })
      .to(b.position, { y: 1.6, duration: 0.9, ease: 'power2.out' })
      .to(b.rotation, { z: 0.12, duration: 0.25, yoyo: true, repeat: 1, ease: 'sine.inOut' }, '<0.6')
      .to(b.position, { y: 0.1, duration: 0.8, ease: 'power2.in' })
      .set(b, { visible: false })
      .to(u.scale, { x: 1.05, y: 0.95, z: 1.05, duration: 0.14, yoyo: true, repeat: 1, ease: 'power1.out' })
      .call(() => setCelebrate(true))
    return () => {
      tl.kill()
    }
  }, [phase])

  useFrame((state) => {
    const u = urn.current
    if (!u) return
    const t = state.clock.elapsedTime
    u.rotation.y = THREE.MathUtils.lerp(u.rotation.y, Math.sin(t * 0.5) * 0.25 + state.pointer.x * 0.4, 0.05)
    u.position.y = Math.sin(t * 1.2) * 0.04
  })

  return (
    <>
      <group ref={urn}>
        {/* Corps en plastique blanc */}
        <RoundedBox args={[2.2, 1.7, 1.5]} radius={0.12} smoothness={4}>
          <meshPhysicalMaterial color="#f4f4f2" roughness={0.4} clearcoat={0.5} />
        </RoundedBox>
        {/* Bandeau bleu SA */}
        <mesh position={[0, -0.45, 0]}>
          <boxGeometry args={[2.24, 0.12, 1.54]} />
          <meshStandardMaterial color={SA_BLUE} roughness={0.4} />
        </mesh>
        {/* Couvercle sombre */}
        <RoundedBox args={[2.36, 0.16, 1.66]} radius={0.05} smoothness={3} position={[0, 0.92, 0]}>
          <meshStandardMaterial color="#1a1a1a" roughness={0.35} />
        </RoundedBox>
        {/* Fente lumineuse */}
        <mesh position={[0, 1.005, 0]}>
          <boxGeometry args={[1.25, 0.012, 0.13]} />
          <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
        {/* Monogramme SA sur la face avant */}
        <mesh geometry={mark} position={[0, 0.2, 0.76]}>
          <meshStandardMaterial color="#28476a" roughness={0.5} />
        </mesh>
      </group>

      {/* Bulletin : feuille blanche, bande bleue, dans l'axe de la fente */}
      <group ref={ballot} position={[0, 3, 0]} visible={phase === 'drop'}>
        <mesh>
          <boxGeometry args={[0.9, 0.62, 0.02]} />
          <meshStandardMaterial color="#ffffff" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.2, 0.012]}>
          <boxGeometry args={[0.7, 0.06, 0.005]} />
          <meshStandardMaterial color={SA_BLUE} />
        </mesh>
      </group>

      {celebrate && <Sparkles count={28} scale={[4, 3, 2]} size={5} speed={0.6} color={GLOW} position={[0, 1, 0]} />}
    </>
  )
}

export default function UrnScene({ phase }: Props) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.6, 6], fov: 38 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 5, 5]} intensity={2.2} />
      <directionalLight position={[-4, 2, 2]} intensity={0.5} />
      <Urn phase={phase} />
      <ContactShadows position={[0, -0.9, 0]} opacity={0.35} scale={7} blur={2.4} far={2.5} />
    </Canvas>
  )
}
