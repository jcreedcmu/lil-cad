# lil-cad

A first-person 3D CAD toy. Walk around a scene, draw polygons on the ground plane, and extrude them into solid geometry you can walk on.

Built with [Three.js](https://threejs.org/), [cannon-es](https://pmndrs.github.io/cannon-es/), and [Vite](https://vitejs.dev/).

## Controls

- **Mouse** — look around (click to capture pointer)
- **WASD** — move
- **Space** — jump
- **Click** — place vertices / close polygon / confirm extrusion
- **Right-click** — cancel current polygon
- **Arrow Up/Down** — adjust extrusion height

## Workflow

1. Look at a grid vertex near the crosshair (it highlights yellow when snapped)
2. Click to start placing vertices of a polygon
3. Click the first vertex again to close the shape
4. Use Arrow Up/Down to set the extrusion height (translucent preview)
5. Click to confirm — the solid is added to the scene with physics

## Running

```
npm install
npm run dev
```
