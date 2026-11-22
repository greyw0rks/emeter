"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { circuitSignals, circuitWires, signalPositions } from "./circuit-graph";

function Wire({ source, target, active }: { source: number; target: number; active: boolean }) {
  const line = useMemo(() => {
    const [x1, y1] = signalPositions[source]!, [x2, y2] = signalPositions[target]!;
    const midpoint = (x1 + x2) / 2;
    const points = [[x1 + .36, y1, -.1], [midpoint, y1, -.1], [midpoint, y2, -.1], [x2 - .36, y2, -.1]];
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point as [number, number, number]))),
      new THREE.LineBasicMaterial({ color: active ? "#63efb7" : "#3b5159" }));
  }, [source, target, active]);
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  return <primitive object={line} />;
}
function Node({ id, active }: { id: number; active: boolean }) {
  const [x, y] = signalPositions[id]!;
  const text = id < 8 ? String.fromCharCode(65 + id - 2) : id === 18 ? active ? "ALLOW" : "DENY" : "N" + (id - 7);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = id === 18 ? 320 : 192; canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = active ? "#080c0d" : "#c5d7d0";
    context.font = "500 104px " + (getComputedStyle(document.body).getPropertyValue("--font-geist-mono").trim() || "monospace");
    context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(text, canvas.width / 2, 64);
    const result = new THREE.CanvasTexture(canvas); result.colorSpace = THREE.SRGBColorSpace; return result;
  }, [text, active]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group position={[x, y, 0]}><mesh><boxGeometry args={[id === 18 ? 1.2 : .72, .48, .22]} />
    <meshStandardMaterial color={active ? "#63efb7" : "#243238"} roughness={.6} metalness={.1} /></mesh>
    <mesh position={[0, 0, .12]}><planeGeometry args={[id === 18 ? 1.125 : .675, .45]} /><meshBasicMaterial map={texture} transparent depthWrite={false} /></mesh>
    <mesh position={[-.4, 0, -.02]}><boxGeometry args={[.11, .13, .09]} /><meshBasicMaterial color={active ? "#63efb7" : "#58737d"} /></mesh>
    <mesh position={[id === 18 ? .56 : .4, 0, -.02]}><boxGeometry args={[.11, .13, .09]} /><meshBasicMaterial color={active ? "#63efb7" : "#58737d"} /></mesh>
  </group>;
}
function Graph({ mask }: { mask: number }) {
  const group = useRef<THREE.Group>(null), { camera, size, invalidate } = useThree();
  const values = circuitSignals(mask);
  useEffect(() => { invalidate(); }, [mask, invalidate]);
  useEffect(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    camera.zoom = Math.min(52, size.width / 12, size.height / 7);
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, invalidate]);
  useFrame((_state, delta) => {
    if (!group.current) return;
    const target = values[18] ? .1 : -.035;
    group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, target, 9, delta);
    if (Math.abs(group.current.rotation.x - target) > .001) invalidate();
  });
  return <group ref={group} rotation={[.07, -.06, -.04]}>
    {circuitWires.map(wire => <Wire key={`${wire.source}-${wire.target}`} {...wire} active={values[wire.source]!} />)}
    {Object.keys(signalPositions).map(id => <Node key={id} id={Number(id)} active={values[Number(id)]!} />)}
  </group>;
}
export default function CircuitScene({ mask, onFailure, onReady }: { mask: number; onFailure: () => void; onReady: () => void }) {
  return <Canvas orthographic camera={{ position: [0, 0, 12], zoom: 52, near: .1, far: 100 }} dpr={[1, 1.5]} frameloop="demand"
    gl={{ antialias: true, alpha: true, powerPreference: "low-power" }} onCreated={({ gl }) => {
      gl.domElement.addEventListener("webglcontextlost", event => { event.preventDefault(); onFailure(); }, { once: true });
      requestAnimationFrame(() => requestAnimationFrame(onReady));
    }} fallback={null} aria-hidden="true"><ambientLight intensity={2} /><directionalLight position={[3, 4, 8]} intensity={2} /><Graph mask={mask} /></Canvas>;
}
