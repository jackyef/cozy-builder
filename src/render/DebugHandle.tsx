/**
 * A window handle onto the live scene, for debugging.
 *
 * Rendering bugs in a scene like this are usually invisible in the code and
 * obvious in the object graph — a shadow camera whose projection matrix was
 * never rebuilt, a light whose intensity is not what the JSX says, a material
 * that silently shares a compiled program with another. Reading those values
 * out of the running page is far quicker than reasoning about them.
 *
 * Attaches only when the URL contains `?debug`, so it costs nothing normally:
 *
 * ```
 * http://localhost:5173/?debug
 * ```
 * ```js
 * __cozy.report()                     // lights, shadows, draw calls, triangles
 * __cozy.gl.info.render.calls         // anything on the renderer
 * __cozy.scene.traverse(console.log)  // walk the graph
 * ```
 *
 * See `docs/development.md`.
 */

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { DirectionalLight, HemisphereLight } from 'three'

declare global {
  // eslint-disable-next-line no-var
  var __cozy: Record<string, unknown> | undefined
}

export function DebugHandle(): null {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.location.search.includes('debug')) return

    const report = (): unknown => {
      let sun: DirectionalLight | null = null
      let hemi: HemisphereLight | null = null
      let meshes = 0
      let instanced = 0
      let receiving = 0
      let casting = 0
      scene.traverse((object) => {
        if ((object as { isMesh?: boolean }).isMesh) {
          if (object.receiveShadow) receiving++
          if (object.castShadow) casting++
        }
        const o = object as unknown as Record<string, boolean>
        if (o.isDirectionalLight) sun = object as DirectionalLight
        if (o.isHemisphereLight) hemi = object as HemisphereLight
        if (o.isInstancedMesh) instanced++
        else if (o.isMesh) meshes++
      })

      const light = sun as DirectionalLight | null
      return {
        renderer: {
          shadowsEnabled: gl.shadowMap.enabled,
          shadowType: gl.shadowMap.type,
          shadowAutoUpdate: gl.shadowMap.autoUpdate,
          toneMapping: gl.toneMapping,
          drawCalls: gl.info.render.calls,
          triangles: gl.info.render.triangles,
          programs: gl.info.programs?.length,
        },
        counts: { meshes, instancedMeshes: instanced, receiving, casting },
        camera: { position: camera.position.toArray(), fov: (camera as { fov?: number }).fov },
        sun: light && {
          intensity: light.intensity,
          castShadow: light.castShadow,
          position: light.position.toArray(),
          shadowMapAllocated: Boolean(light.shadow.map),
          shadowMapSize: [light.shadow.mapSize.x, light.shadow.mapSize.y],
          shadowIntensity: light.shadow.intensity,
          frustum: {
            left: light.shadow.camera.left,
            right: light.shadow.camera.right,
            top: light.shadow.camera.top,
            bottom: light.shadow.camera.bottom,
            near: light.shadow.camera.near,
            far: light.shadow.camera.far,
          },
          // The projection matrix is the ground truth. If it disagrees with the
          // frustum above, `updateProjectionMatrix()` was never called and the
          // shadows are being clipped to a stale, much smaller box.
          projectionHalfWidth: 1 / light.shadow.camera.projectionMatrix.elements[0],
          projectionHalfHeight: 1 / light.shadow.camera.projectionMatrix.elements[5],
        },
        hemisphere: hemi && { intensity: (hemi as HemisphereLight).intensity },
      }
    }

    // three itself, so a console session can build materials and geometry to
    // test against the live scene.
    window.__cozy = { gl, scene, camera, report, THREE }
    return () => {
      delete window.__cozy
    }
  }, [gl, scene, camera])

  return null
}
