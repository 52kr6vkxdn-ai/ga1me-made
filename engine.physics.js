/* ============================================================
   Zengine — engine.physics.js  (PLANCK.JS BACKEND)
   Physics backend replaced: Matter.js → Planck.js
   All exported APIs and object interfaces unchanged.
   ============================================================ */

import { state } from './engine.state.js';
import {
    collisionGeom, rawSpriteSize,
    tileAlphaBoundsForAsset, unionTileAlphaBounds,
} from './engine.collision-overlay.js';

const PLANCK_CDN = 'https://cdn.jsdelivr.net/npm/planck@1.0.0/dist/planck.min.js';

// px/s² — 980 = 9.8 m/s² with 100 px = 1 m
const GRAVITY_PX = 980;

// ── Module state ───────────────────────────────────────────────
let _world  = null;
let _rafId  = null;
let _bodies     = [];   // { obj, body: planck.Body, type }[]
let _tileBodies = [];   // { body: planck.Body, ownerLabel }[]
const _pendingCollisions  = [];
const _kinematicContacts  = new Map();

// ── Collision event dispatch ──────────────────────────────────
function _fireCollisionEvents() {
    if (_pendingCollisions.length === 0) return;
    const batch = _pendingCollisions.splice(0);
    import('./engine.scripting.js').then(m => {
        for (const { p: pair, type } of batch) {
            const entA = _bodies.find(e => e.body === pair.bodyA);
            const entB = _bodies.find(e => e.body === pair.bodyB);
            if (entA && entB) {
                if (type === 'start') m.triggerCollision(entA.obj, entB.obj);
                else                  m.triggerCollisionEnd(entA.obj, entB.obj);
                continue;
            }
            const spriteEnt = entA || entB;
            if (!spriteEnt) continue;
            const otherBody = spriteEnt === entA ? pair.bodyB : pair.bodyA;
            const tileEnt   = _tileBodies.find(t => t.body === otherBody);
            if (!tileEnt) continue;
            import('./engine.state.js').then(({ state }) => {
                const tileObj = state.gameObjects.find(o => o.label === tileEnt.ownerLabel);
                if (!tileObj) return;
                if (type === 'start') m.triggerCollision(spriteEnt.obj, tileObj);
                else                  m.triggerCollisionEnd(spriteEnt.obj, tileObj);
            });
        }
    });
}

// ── CDN loader ────────────────────────────────────────────────
function _loadPlanck() {
    return new Promise((resolve, reject) => {
        if (window.planck) { resolve(); return; }
        const el = document.getElementById('planck-js-script');
        if (el) {
            el.addEventListener('load',  resolve);
            el.addEventListener('error', () => reject(new Error('Planck.js load failed')));
            return;
        }
        const s  = document.createElement('script');
        s.id     = 'planck-js-script';
        s.src    = PLANCK_CDN;
        s.onload  = resolve;
        s.onerror = () => reject(new Error('Planck.js load failed: ' + PLANCK_CDN));
        document.head.appendChild(s);
    });
}

// ── Size helpers ───────────────────────────────────────────────
function _rawSize(obj) {
    const sg  = obj.spriteGraphic;
    const rs  = obj._runtimeSprite;
    const src = sg || rs;
    if (src?.texture?.orig)  return { w: src.texture.orig.width,  h: src.texture.orig.height };
    if (src?.texture?.width) return { w: src.texture.width,       h: src.texture.height };
    const sx = Math.abs(obj.scale?.x ?? 1) || 1;
    const sy = Math.abs(obj.scale?.y ?? 1) || 1;
    if (src?.width && src?.height) return { w: src.width / sx, h: src.height / sy };
    return { w: 40, h: 40 };
}

function _innerScale(obj) {
    const src = obj.spriteGraphic || obj._runtimeSprite;
    return {
        x: Math.abs(src?.scale?.x ?? 1) || 1,
        y: Math.abs(src?.scale?.y ?? 1) || 1,
    };
}

export function migratePolygonsToContainer(obj) {
    if (!obj || obj._polyUnit === 'container') return;
    const { x: ssx, y: ssy } = _innerScale(obj);
    if (ssx === 1 && ssy === 1) { obj._polyUnit = 'container'; return; }
    if (Array.isArray(obj.physicsPolygon)) {
        obj.physicsPolygon = obj.physicsPolygon.map(p => ({ x: p.x * ssx, y: p.y * ssy }));
    }
    if (obj.physicsPolygons && typeof obj.physicsPolygons === 'object') {
        for (const k in obj.physicsPolygons) {
            const arr = obj.physicsPolygons[k];
            if (Array.isArray(arr)) {
                obj.physicsPolygons[k] = arr.map(p => ({ x: p.x * ssx, y: p.y * ssy }));
            }
        }
    }
    obj._polyUnit = 'container';
}

// ── Active polygon for animated frame ────────────────────────
function _getActivePolygon(obj) {
    migratePolygonsToContainer(obj);
    const map = obj.physicsPolygons;
    if (!map) return obj.physicsPolygon || null;
    if (obj._runtimePhysicsFrameId
        && Array.isArray(map[obj._runtimePhysicsFrameId])
        && map[obj._runtimePhysicsFrameId].length >= 3) {
        return map[obj._runtimePhysicsFrameId];
    }
    const anim    = obj.animations?.[obj.activeAnimIndex ?? 0];
    const frameId = anim?.frames?.[0]?.id;
    if (frameId && Array.isArray(map[frameId]) && map[frameId].length >= 3) return map[frameId];
    if (Array.isArray(map.shared) && map.shared.length >= 3) return map.shared;
    return null;
}

// ── Fixture / body options ────────────────────────────────────
function _bodyOpts(obj) {
    return {
        isSensor:           !!obj.physicsIsSensor,
        friction:           obj.physicsFriction    ?? 0.3,
        restitution:        obj.physicsRestitution ?? 0.1,
        density:            obj.physicsDensity     ?? 0.001,
        filterCategoryBits: (obj.physicsCollisionCategory ?? 0x0001) & 0xFFFF,
        filterMaskBits:     (obj.physicsCollisionMask ?? -1) >>> 0 & 0xFFFF,
    };
}

// ── Get world-space AABB of a Planck body ─────────────────────
function _getPlanckBodyBounds(body) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let f = body.getFixtureList(); f; f = f.getNext()) {
        try {
            const aabb = f.getAABB(0);
            if (aabb.lowerBound.x < minX) minX = aabb.lowerBound.x;
            if (aabb.lowerBound.y < minY) minY = aabb.lowerBound.y;
            if (aabb.upperBound.x > maxX) maxX = aabb.upperBound.x;
            if (aabb.upperBound.y > maxY) maxY = aabb.upperBound.y;
        } catch (_) {}
    }
    if (!isFinite(minX)) {
        const pos = body.getPosition();
        return { min: { x: pos.x - 16, y: pos.y - 16 }, max: { x: pos.x + 16, y: pos.y + 16 } };
    }
    return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
}

// ── Build a Planck body for a game object ─────────────────────
function _makeBody(obj, cx, cy, bodyType) {
    const P    = window.planck;
    const opts = _bodyOpts(obj);
    const sx   = Math.abs(obj.scale?.x ?? 1) || 1;
    const sy   = Math.abs(obj.scale?.y ?? 1) || 1;
    const g    = collisionGeom(obj);
    const w    = g.w * sx;
    const h    = g.h * sy;
    const r    = g.r * Math.min(sx, sy);
    const ox   = (g.ox || 0) * sx;
    const oy   = (g.oy || 0) * sy;

    // Body positioned at the collider centre (includes rotated offset)
    const rot  = obj.rotation || 0;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    const bcx  = cx + ox * cosR - oy * sinR;
    const bcy  = cy + ox * sinR + oy * cosR;

    const shape = obj.physicsShape ?? 'box';
    const poly  = _getActivePolygon(obj);

    // kinematic bodies: treated as static + manually teleported each frame
    const isStatic = bodyType === 'static' || bodyType === 'kinematic';

    const body = _world.createBody({
        type:           isStatic ? 'static' : 'dynamic',
        position:       P.Vec2(bcx, bcy),
        angle:          bodyType !== 'static' ? rot : 0,
        linearDamping:  obj.physicsLinearDamping  ?? 0.01,
        angularDamping: obj.physicsAngularDamping ?? 0,
        fixedRotation:  bodyType === 'dynamic' && !!obj.physicsFixedRotation,
        userData:       { label: obj.label },
    });

    const fixDef = {
        density:            bodyType === 'dynamic' ? (opts.density || 0.001) : 0,
        friction:           opts.friction,
        restitution:        opts.restitution,
        isSensor:           opts.isSensor,
        filterCategoryBits: opts.filterCategoryBits,
        filterMaskBits:     opts.filterMaskBits,
        filterGroupIndex:   0,
    };

    if (shape === 'circle') {
        body.createFixture({ ...fixDef, shape: P.Circle(Math.max(r, 2)) });
    } else if (shape === 'capsule') {
        const capW = (obj.physicsSize?.capW ?? g.w) * sx;
        const capH = (obj.physicsSize?.capH ?? g.h) * sy;
        const capR = Math.min(capW, capH) / 2;
        const len  = Math.max(capW, capH) / 2 - capR;
        const capFix = { ...fixDef, density: bodyType === 'dynamic' ? ((opts.density || 0.001) / 3) : 0 };
        try {
            if (capW >= capH) {
                body.createFixture({ ...capFix, shape: P.Box(Math.max(len, 1), Math.max(capH / 2, 1)) });
                body.createFixture({ ...capFix, shape: P.Circle(P.Vec2(len, 0), Math.max(capR, 1)) });
                body.createFixture({ ...capFix, shape: P.Circle(P.Vec2(-len, 0), Math.max(capR, 1)) });
            } else {
                body.createFixture({ ...capFix, shape: P.Box(Math.max(capW / 2, 1), Math.max(len, 1)) });
                body.createFixture({ ...capFix, shape: P.Circle(P.Vec2(0, -len), Math.max(capR, 1)) });
                body.createFixture({ ...capFix, shape: P.Circle(P.Vec2(0,  len), Math.max(capR, 1)) });
            }
        } catch (e) {
            console.warn('[Physics] capsule fixture failed, using box:', e.message);
            body.createFixture({ ...fixDef, shape: P.Box(Math.max(w / 2, 2), Math.max(h / 2, 2)) });
        }
    } else if ((shape === 'polygon' || shape === 'shared') && Array.isArray(poly) && poly.length >= 3) {
        try {
            const verts = poly.slice(0, 8).map(p => P.Vec2(p.x * sx, p.y * sy));
            body.createFixture({ ...fixDef, shape: P.Polygon(verts) });
        } catch (e) {
            console.warn('[Physics] polygon fixture failed, using box:', e.message);
            body.createFixture({ ...fixDef, shape: P.Box(Math.max(w / 2, 2), Math.max(h / 2, 2)) });
        }
    } else {
        body.createFixture({ ...fixDef, shape: P.Box(Math.max(w / 2, 2), Math.max(h / 2, 2)) });
    }

    body._zenOffset = { x: ox, y: oy };
    return body;
}

// ── startPhysics ──────────────────────────────────────────────
export async function startPhysics() {
    if (_world) stopPhysics();
    try { await _loadPlanck(); }
    catch (err) { console.error('[Physics]', err); return; }

    const P = window.planck;
    _world = P.World({ gravity: P.Vec2(0, 0) });
    _bodies           = [];
    _tileBodies.length = 0;
    _kinematicContacts.clear();

    for (const obj of state.gameObjects) {
        // ── Tilemap → one static body per filled cell ────────
        if (obj.isTilemap) {
            const td = obj.tilemapData;
            for (let row = 0; row < td.rows; row++) {
                for (let col = 0; col < td.cols; col++) {
                    const aid = td.tiles[row * td.cols + col];
                    if (!aid) continue;
                    const ab = tileAlphaBoundsForAsset(aid, td.tileW, td.tileH);
                    const cx = obj.x + col * td.tileW + td.tileW / 2 + ab.ox;
                    const cy = obj.y + row * td.tileH + td.tileH / 2 + ab.oy;
                    const tb = _world.createBody({ type: 'static', position: P.Vec2(cx, cy) });
                    tb.createFixture({ shape: P.Box(Math.max(ab.w / 2, 1), Math.max(ab.h / 2, 1)), friction: 0.3, restitution: 0.1 });
                    tb.setUserData({ label: `tm_${obj.label}_${row}_${col}` });
                    tb._zenOffset = { x: 0, y: 0 };
                    _tileBodies.push({ body: tb, ownerLabel: obj.label });
                }
            }
            continue;
        }

        if (obj.isAutoTilemap) {
            const d = obj.autoTileData;
            for (let row = 0; row < d.rows; row++) {
                for (let col = 0; col < d.cols; col++) {
                    const v   = d.cells[row * d.cols + col];
                    const ids = Array.isArray(v) ? v : (v ? [v] : []);
                    if (!ids.length) continue;
                    const ab = unionTileAlphaBounds(ids, d.tileW, d.tileH);
                    const cx = obj.x + col * d.tileW + d.tileW / 2 + ab.ox;
                    const cy = obj.y + row * d.tileH + d.tileH / 2 + ab.oy;
                    const tb = _world.createBody({ type: 'static', position: P.Vec2(cx, cy) });
                    tb.createFixture({ shape: P.Box(Math.max(ab.w / 2, 1), Math.max(ab.h / 2, 1)), friction: 0.3, restitution: 0.1 });
                    tb.setUserData({ label: `at_${obj.label}_${row}_${col}` });
                    tb._zenOffset = { x: 0, y: 0 };
                    _tileBodies.push({ body: tb, ownerLabel: obj.label });
                }
            }
            continue;
        }

        // ── Regular sprite ────────────────────────────────────
        const type = obj.physicsBody || 'none';
        if (type === 'none') continue;

        if (type === 'kinematic') {
            obj._kinematicVx           = 0;
            obj._kinematicVy           = 0;
            obj._pendingKinematicDelta = { x: 0, y: 0 };
            obj._kinematicPrevX        = obj.x;
            obj._kinematicPrevY        = obj.y;
            _kinematicContacts.set(obj, new Set());
            const kBody = _makeBody(obj, obj.x, obj.y, 'kinematic');
            if (kBody) {
                _bodies.push({ obj, body: kBody, type: 'kinematic' });
                obj._physicsBody = kBody;
            } else {
                _bodies.push({ obj, body: null, type: 'kinematic' });
            }
            continue;
        }

        const body = _makeBody(obj, obj.x, obj.y, type);
        if (!body) continue;

        const entry = { obj, body, type };
        _bodies.push(entry);
        obj._physicsBody = body;

        // Per-frame collision shape swap for animated sprites
        const as    = obj._runtimeSprite;
        const anim  = obj.animations?.[obj.activeAnimIndex ?? 0];
        const frArr = anim?.frames;
        if (type !== 'static' && as && as.onFrameChange !== undefined && frArr?.length > 1) {
            obj._runtimePhysicsFrameId = frArr[as.currentFrame ?? 0]?.id || frArr[0].id;
            as.onFrameChange = (idx) => {
                const f = frArr[idx];
                if (!f || obj._runtimePhysicsFrameId === f.id) return;
                obj._runtimePhysicsFrameId = f.id;
                _rebuildBodyForFrame(entry);
            };
        } else if (type !== 'static') {
            const f0 = frArr?.[0];
            if (f0?.id) obj._runtimePhysicsFrameId = f0.id;
        }
    }

    // Wire Planck.js collision events
    _world.on('begin-contact', (contact) => {
        const bodyA = contact.getFixtureA().getBody();
        const bodyB = contact.getFixtureB().getBody();
        _pendingCollisions.push({ p: { bodyA, bodyB }, type: 'start' });
    });
    _world.on('end-contact', (contact) => {
        const bodyA = contact.getFixtureA().getBody();
        const bodyB = contact.getFixtureB().getBody();
        _pendingCollisions.push({ p: { bodyA, bodyB }, type: 'end' });
    });

    _rafId = 1;
}

// ── AABB helpers for kinematic sweep ─────────────────────────
function _getKinematicAABB(obj) {
    const sx = Math.abs(obj.scale?.x ?? 1) || 1;
    const sy = Math.abs(obj.scale?.y ?? 1) || 1;
    const g  = collisionGeom(obj);
    const w  = (g.w || 32) * sx;
    const h  = (g.h || 32) * sy;
    const ox = (g.ox || 0) * sx;
    const oy = (g.oy || 0) * sy;
    return { x: obj.x + ox - w / 2, y: obj.y + oy - h / 2, w, h };
}

// Skin tolerance — prevents false-positive when the body is flush against a surface
const SWEEP_SKIN  = 1;   // px
// Distance to probe below feet to detect ground while standing still
const PROBE_DIST  = 4;   // px

// Axis-separated AABB sweep (X then Y) with skin tolerance and direction flags.
// Returns resolved (x, y) corner plus hit booleans and the list of touched statics.
function _sweepAABB(ax, ay, aw, ah, dx, dy, statics) {
    let x = ax, y = ay;
    let hitX = false, hitY = false;
    let hitDown = false, hitUp = false, hitLeft = false, hitRight = false;
    const hitStatics = [];

    // ── X pass ────────────────────────────────────────────────
    x += dx;
    for (const s of statics) {
        // Require meaningful vertical overlap (inset by SKIN on both sides)
        const overY = (y + ah - SWEEP_SKIN > s.y + SWEEP_SKIN) &&
                      (y + SWEEP_SKIN       < s.y + s.h - SWEEP_SKIN);
        if (!overY) continue;
        if (x + aw - SWEEP_SKIN > s.x && x + SWEEP_SKIN < s.x + s.w) {
            hitX = true;
            if (dx > 0) { x = s.x - aw;      hitRight = true; }
            else        { x = s.x + s.w;      hitLeft  = true; }
            if (!hitStatics.includes(s)) hitStatics.push(s);
        }
    }

    // ── Y pass ────────────────────────────────────────────────
    y += dy;
    for (const s of statics) {
        const overX = (x + aw - SWEEP_SKIN > s.x + SWEEP_SKIN) &&
                      (x + SWEEP_SKIN       < s.x + s.w - SWEEP_SKIN);
        if (!overX) continue;
        if (y + ah - SWEEP_SKIN > s.y && y + SWEEP_SKIN < s.y + s.h) {
            hitY = true;
            if (dy > 0) { y = s.y - ah;       hitDown = true; }
            else        { y = s.y + s.h;       hitUp   = true; }
            if (!hitStatics.includes(s)) hitStatics.push(s);
        }
    }

    return { x, y, hitX, hitY, hitDown, hitUp, hitLeft, hitRight, hitStatics };
}

// Check if there is a solid surface within PROBE_DIST px below the AABB.
// Used to detect ground while standing still (no downward movement this frame).
function _probeGround(aabb, statics) {
    const { x: ax, y: ay, w: aw, h: ah } = aabb;
    for (const s of statics) {
        const overX = (ax + aw - SWEEP_SKIN > s.x + SWEEP_SKIN) &&
                      (ax + SWEEP_SKIN       < s.x + s.w - SWEEP_SKIN);
        if (!overX) continue;
        const gap = s.y - (ay + ah);
        if (gap >= -SWEEP_SKIN && gap <= PROBE_DIST) return true;
    }
    return false;
}

// Static grid for the kinematic AABB sweep.
// excludeObj — the kinematic object currently being swept (excluded to avoid self-collision).
// Includes: tile cells, static-type bodies, other kinematic bodies, non-sensor dynamic bodies.
function _buildStaticGrid(excludeObj = null) {
    const statics = [];

    // 1. Tilemap / auto-tilemap cells (always static)
    for (const t of _tileBodies) {
        const b = _getPlanckBodyBounds(t.body);
        statics.push({
            x: b.min.x, y: b.min.y,
            w: b.max.x - b.min.x,
            h: b.max.y - b.min.y,
            ownerLabel: t.ownerLabel,
        });
    }

    // 2. All non-sensor sprite bodies except the object being swept
    for (const { obj: o, body, type } of _bodies) {
        if (o === excludeObj || !body || o.physicsIsSensor) continue;

        if (type === 'static' || type === 'kinematic') {
            // Use the object's live position — it may have just been updated this frame
            const aabb = _getKinematicAABB(o);
            statics.push({ x: aabb.x, y: aabb.y, w: aabb.w, h: aabb.h, ownerLabel: o.label });
        } else if (type === 'dynamic') {
            // Use Planck body bounds (position from the last physics step)
            const b = _getPlanckBodyBounds(body);
            statics.push({
                x: b.min.x, y: b.min.y,
                w: b.max.x - b.min.x,
                h: b.max.y - b.min.y,
                ownerLabel: o.label,
            });
        }
    }

    return statics;
}

// ── stepPhysics(dt) ───────────────────────────────────────────
export function stepPhysics(dt) {
    if (!_world) return;
    if (state.isPaused) return;

    const P = window.planck;

    // ── KINEMATIC BODIES ──────────────────────────────────────
    // Each kinematic object gets its own static grid (excludes itself so it
    // doesn't self-collide) that includes: tile cells, static sprite bodies,
    // other kinematic bodies, and non-sensor dynamic bodies.
    for (const { obj, body, type } of _bodies) {
        if (type !== 'kinematic') continue;

        // Immovable kinematic: just keep Planck body in sync and stay put
        if (obj.physicsImmovable) {
            obj._kinematicVx           = 0;
            obj._kinematicVy           = 0;
            obj._pendingKinematicDelta = { x: 0, y: 0 };
            obj._kinematicPrevX        = obj.x;
            obj._kinematicPrevY        = obj.y;
            obj._isOnGround  = false;
            obj._isOnCeiling = false;
            obj._isOnWall    = false;
            if (body) {
                const off  = body._zenOffset || { x: 0, y: 0 };
                const cosR = Math.cos(obj.rotation || 0);
                const sinR = Math.sin(obj.rotation || 0);
                body.setTransform(
                    P.Vec2(obj.x + off.x * cosR - off.y * sinR,
                           obj.y + off.x * sinR + off.y * cosR),
                    obj.rotation || 0
                );
            }
            continue;
        }

        // 1. Consume desired velocity / pending delta from scripts
        const vx = obj._kinematicVx ?? 0;
        const vy = obj._kinematicVy ?? 0;
        obj._kinematicVx = 0;
        obj._kinematicVy = 0;
        const pd = obj._pendingKinematicDelta || { x: 0, y: 0 };
        obj._pendingKinematicDelta = { x: 0, y: 0 };

        // directDx/Y: any teleport/position-write done directly by scripts this frame
        const prevX = obj._kinematicPrevX ?? obj.x;
        const prevY = obj._kinematicPrevY ?? obj.y;
        const directDx = obj.x - prevX;
        const directDy = obj.y - prevY;

        // Total desired displacement in px (screen space, +Y = down)
        const dx = vx * dt + pd.x + directDx;
        const dy = vy * dt + pd.y + directDy;

        // 2. Build static grid excluding this object
        const statics = _buildStaticGrid(obj);

        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
            // Not moving this frame — only run the ground probe for isOnGround
            const aabb = _getKinematicAABB(obj);
            obj._isOnGround  = _probeGround(aabb, statics);
            obj._isOnCeiling = false;
            obj._isOnWall    = false;
            obj._kinematicActualVx = 0;
            obj._kinematicActualVy = 0;
            obj._kinematicPrevX = obj.x;
            obj._kinematicPrevY = obj.y;
            if (body) {
                const off  = body._zenOffset || { x: 0, y: 0 };
                const cosR = Math.cos(obj.rotation || 0);
                const sinR = Math.sin(obj.rotation || 0);
                body.setTransform(
                    P.Vec2(obj.x + off.x * cosR - off.y * sinR,
                           obj.y + off.x * sinR + off.y * cosR),
                    obj.rotation || 0
                );
            }
            continue;
        }

        // 3. Reset to last confirmed-safe position before sweeping
        //    (scripts may have written to obj.x/y; directDx captured the delta)
        obj.x = prevX;
        obj.y = prevY;

        // 4–7. Substep the sweep so fast-moving kinematics never tunnel through
        //      dynamic objects. Each substep: sweep a fraction of dx/dy, teleport
        //      the Planck body, run a mini world.step so dynamics get pushed out
        //      incrementally — same SUBSTEPS count used by the main Planck loop.
        const KIN_SUBSTEPS = 3;
        const subDx = dx / KIN_SUBSTEPS;
        const subDy = dy / KIN_SUBSTEPS;
        const subDt = dt / KIN_SUBSTEPS;

        const scX = Math.abs(obj.scale?.x ?? 1) || 1;
        const scY = Math.abs(obj.scale?.y ?? 1) || 1;
        const g   = collisionGeom(obj);
        const ox  = (g.ox || 0) * scX;
        const oy  = (g.oy || 0) * scY;

        let nx = 0, ny = 0;
        let hitX = false, hitY = false;
        let hitDown = false, hitUp = false, hitLeft = false, hitRight = false;
        const hitStatics = [];
        let curAabb = _getKinematicAABB(obj);

        for (let _ks = 0; _ks < KIN_SUBSTEPS; _ks++) {
            // Rebuild static grid each substep — dynamic positions may have shifted
            const subStatics = _buildStaticGrid(obj);
            const res = _sweepAABB(curAabb.x, curAabb.y, curAabb.w, curAabb.h, subDx, subDy, subStatics);

            nx = res.x; ny = res.y;
            if (res.hitX) { hitX = true; hitLeft  = hitLeft  || res.hitLeft;  hitRight = hitRight || res.hitRight; }
            if (res.hitY) { hitY = true; hitDown  = hitDown  || res.hitDown;  hitUp    = hitUp    || res.hitUp; }
            for (const s of res.hitStatics) if (!hitStatics.includes(s)) hitStatics.push(s);

            // Apply sub-resolved position to sprite
            obj.x = nx + curAabb.w / 2 - ox;
            obj.y = ny + curAabb.h / 2 - oy;

            // Teleport Planck body so dynamics are pushed out this substep
            if (body) {
                const off  = body._zenOffset || { x: 0, y: 0 };
                const cosR = Math.cos(obj.rotation || 0);
                const sinR = Math.sin(obj.rotation || 0);
                body.setTransform(
                    P.Vec2(obj.x + off.x * cosR - off.y * sinR,
                           obj.y + off.x * sinR + off.y * cosR),
                    obj.rotation || 0
                );
            }

            // Mini world step — pushes dynamics out of the kinematic body
            _world.step(subDt, 8, 3);

            // After Planck depenetrates, apply velocity to touched dynamic bodies.
            // Planck only corrects position (ejects the body) but gives it no velocity,
            // so without this the dynamic gets pushed out but immediately stops.
            // We add the kinematic's sub-velocity to any dynamic whose AABB overlaps ours.
            if (Math.abs(subDx) > 0.001 || Math.abs(subDy) > 0.001) {
                const kinAabb = _getKinematicAABB(obj);
                // kinematic velocity in Planck units (px → planck: /100? No — engine uses px directly)
                // subDx/subDy are in px, subDt in seconds → velocity in px/s
                const kvx = subDx / Math.max(subDt, 0.001);
                const kvy = subDy / Math.max(subDt, 0.001);
                for (const { body: dynBody, type: dynType, obj: dynObj } of _bodies) {
                    if (dynType !== 'dynamic' || !dynBody || dynObj.physicsIsSensor) continue;
                    const db = _getPlanckBodyBounds(dynBody);
                    // AABB overlap test
                    if (db.max.x < kinAabb.x || db.min.x > kinAabb.x + kinAabb.w) continue;
                    if (db.max.y < kinAabb.y || db.min.y > kinAabb.y + kinAabb.h) continue;
                    // Overlapping — add kinematic velocity to this dynamic body.
                    // Use setLinearVelocity blended with existing velocity so we don't
                    // cancel motion the dynamic already had from gravity/other forces.
                    const cur = dynBody.getLinearVelocity();
                    // subDx/subDy are screen-space pixels (+Y=down), matching Planck's world
                    const newVx = (kvx !== 0) ? kvx : cur.x;
                    const newVy = (kvy !== 0) ?  kvy : cur.y; // no flip needed
                    dynBody.setLinearVelocity(P.Vec2(newVx, newVy));
                    dynBody.setAwake(true);
                }
            }

            curAabb = _getKinematicAABB(obj);
            if (res.hitX && res.hitY) break; // fully blocked, no need for more substeps
        }

        obj._kinematicPrevX = obj.x;
        obj._kinematicPrevY = obj.y;

        // 6. Ground / wall / ceiling flags
        obj._isOnGround  = hitDown || _probeGround({ x: nx, y: ny, w: curAabb.w, h: curAabb.h }, _buildStaticGrid(obj));
        obj._isOnCeiling = hitUp;
        obj._isOnWall    = hitLeft || hitRight;

        // Track actual velocity (px/s) so physics.velX/velY work for kinematic too
        obj._kinematicActualVx =  (obj.x - prevX) / Math.max(dt, 0.001);
        obj._kinematicActualVy =  (obj.y - prevY) / Math.max(dt, 0.001);

        // 8. Collision events for kinematic ↔ solid surfaces
        if (hitX || hitY) {
            const contacts    = _kinematicContacts.get(obj) || new Set();
            const nowTouching = new Set(hitStatics.map(s => s.ownerLabel).filter(Boolean));
            import('./engine.scripting.js').then(m => {
                for (const label of nowTouching) {
                    if (!contacts.has(label)) {
                        const other = state.gameObjects.find(o => o.label === label);
                        if (other) m.triggerCollision(obj, other);
                    }
                }
                for (const label of contacts) {
                    if (!nowTouching.has(label)) {
                        const other = state.gameObjects.find(o => o.label === label);
                        if (other) m.triggerCollisionEnd(obj, other);
                    }
                }
                _kinematicContacts.set(obj, nowTouching);
            });
        } else {
            const contacts = _kinematicContacts.get(obj);
            if (contacts && contacts.size > 0) {
                import('./engine.scripting.js').then(m => {
                    for (const label of contacts) {
                        const other = state.gameObjects.find(o => o.label === label);
                        if (other) m.triggerCollisionEnd(obj, other);
                    }
                    _kinematicContacts.set(obj, new Set());
                });
            }
        }
    }

    // ── DYNAMIC: apply per-body gravity ───────────────────────
    for (const { obj, body, type } of _bodies) {
        if (type !== 'dynamic' || !body) continue;
        if (body.isStatic()) continue;
        const gravScale = obj.physicsGravityScale ?? 1;
        if (gravScale !== 0) {
            const gy = GRAVITY_PX * 0.001 * gravScale;
            const gx = (obj.physicsGravityXScale ?? 0) * GRAVITY_PX * 0.001;
            body.applyForce(
                P.Vec2(gx * body.getMass(), gy * body.getMass()),
                body.getWorldCenter(),
                true
            );
        }
    }

    // ── VELOCITY CAP: prevent teleportation from extreme speed spikes ─────────
    // If a body is moving faster than MAX_SPEED_PX_S it would travel further than
    // a typical object's width in a single frame, guaranteeing a tunnel.  Cap the
    // velocity here — the body still moves fast, it just can't skip over walls.
    const MAX_SPEED_PX_S = 4000; // 40 world-units/sec — generous but finite
    for (const { body, type } of _bodies) {
        if (type !== 'dynamic' || !body) continue;
        const vel   = body.getLinearVelocity();
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        if (speed > MAX_SPEED_PX_S) {
            const scale = MAX_SPEED_PX_S / speed;
            body.setLinearVelocity(P.Vec2(vel.x * scale, vel.y * scale));
        }
    }

    // Enable bullet (CCD) mode for fast-moving dynamic bodies to prevent tunneling.
    // A body moving faster than ~4 world-units/frame risks skipping through thin objects;
    // bullet mode forces continuous collision detection on those bodies only.
    for (const { obj, body, type } of _bodies) {
        if (type !== 'dynamic' || !body) continue;
        const vel   = body.getLinearVelocity();
        const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        // Enable CCD above ~500 px/s (5 world-units/s).  Disable when slow again to
        // avoid the small CPU cost on every static body.
        body.setBullet(speed > 500);
    }

    // Run Planck in substeps to prevent tunnelling.
    // 6 substeps (up from 3) gives much better collision fidelity at high speeds.
    const SUBSTEPS = 6;
    const subDt    = dt / SUBSTEPS;
    for (let _s = 0; _s < SUBSTEPS; _s++) {
        _world.step(subDt, 8, 4);
    }

    // ── POST-STEP: sync dynamic body position → sprite ────────
    for (const { obj, body, type } of _bodies) {
        if (type !== 'dynamic' || !body) continue;
        const pos  = body.getPosition();
        const ang  = body.getAngle();
        const off  = body._zenOffset || { x: 0, y: 0 };
        const cosR = Math.cos(ang);
        const sinR = Math.sin(ang);
        obj.x = pos.x - (off.x * cosR - off.y * sinR);
        obj.y = pos.y - (off.x * sinR + off.y * cosR);
        obj.rotation = ang;
    }

    _fireCollisionEvents();
}

// ── stopPhysics ───────────────────────────────────────────────
export function stopPhysics() {
    _rafId = null;
    for (const { obj } of _bodies) {
        const as = obj?._runtimeSprite;
        if (as && as.onFrameChange) as.onFrameChange = null;
        if (obj) {
            delete obj._runtimePhysicsFrameId;
            delete obj._physicsBody;
            delete obj._kinematicVx;
            delete obj._kinematicVy;
            delete obj._kinematicActualVx;
            delete obj._kinematicActualVy;
            delete obj._kinematicPrevX;
            delete obj._kinematicPrevY;
            delete obj._pendingKinematicDelta;
            delete obj._isOnGround;
            delete obj._isOnCeiling;
            delete obj._isOnWall;
        }
    }
    _world  = null;
    _bodies = [];
    _tileBodies.length = 0;
    _kinematicContacts.clear();
    _pendingCollisions.length = 0;
}

// ── Ground / wall / ceiling queries ──────────────────────────
/** Returns true if the kinematic body is currently resting on a floor. */
export function getIsOnGround(obj)   { return !!obj._isOnGround; }
/** Returns true if the kinematic body bumped a ceiling this frame. */
export function getIsOnCeiling(obj)  { return !!obj._isOnCeiling; }
/** Returns true if the kinematic body is pressed against a wall. */
export function getIsOnWall(obj)     { return !!obj._isOnWall; }

// ── rebuildBodyForObject ──────────────────────────────────────
/**
 * Remove and destroy the Planck physics body for a game object that has been
 * destroyed at runtime. Called by engine.scripting._destroyObject so the
 * collision shape disappears the same frame the sprite does.
 */
export function removePhysicsBody(obj) {
    if (!_world || !obj) return;
    const idx = _bodies.findIndex(e => e.obj === obj);
    if (idx === -1) return;
    const { body } = _bodies[idx];
    if (body) { try { _world.destroyBody(body); } catch (_) {} }
    delete obj._physicsBody;
    delete obj._kinematicVx;
    delete obj._kinematicVy;
    delete obj._kinematicActualVx;
    delete obj._kinematicActualVy;
    delete obj._kinematicPrevX;
    delete obj._kinematicPrevY;
    delete obj._pendingKinematicDelta;
    delete obj._isOnGround;
    delete obj._isOnCeiling;
    delete obj._isOnWall;
    _bodies.splice(idx, 1);
    _kinematicContacts.delete(obj);
}

export function rebuildBodyForObject(obj) {
    if (!_world) return;
    const idx = _bodies.findIndex(e => e.obj === obj);
    if (idx !== -1) {
        const { body } = _bodies[idx];
        if (body) { try { _world.destroyBody(body); } catch (_) {} }
        delete obj._physicsBody;
        _bodies.splice(idx, 1);
    }
    _kinematicContacts.delete(obj);

    const type = obj.physicsBody;
    if (!type || type === 'none') return;

    if (type === 'kinematic') {
        obj._kinematicVx           = 0;
        obj._kinematicVy           = 0;
        obj._pendingKinematicDelta = { x: 0, y: 0 };
        obj._kinematicPrevX        = obj.x;
        obj._kinematicPrevY        = obj.y;
        _kinematicContacts.set(obj, new Set());
        const kBody = _makeBody(obj, obj.x, obj.y, 'kinematic');
        if (kBody) {
            _bodies.push({ obj, body: kBody, type: 'kinematic' });
            obj._physicsBody = kBody;
        } else {
            _bodies.push({ obj, body: null, type: 'kinematic' });
        }
        return;
    }

    const body = _makeBody(obj, obj.x, obj.y, type);
    if (!body) return;
    _bodies.push({ obj, body, type });
    obj._physicsBody = body;
}

// ── Rebuild body when animation frame changes ─────────────────
function _rebuildBodyForFrame(entry) {
    if (!_world) return;
    const { obj, body: oldBody, type } = entry;
    if (!oldBody || type === 'kinematic') return;

    const pos    = oldBody.getPosition();
    const vel    = oldBody.getLinearVelocity();
    const angle  = oldBody.getAngle();
    const angVel = oldBody.getAngularVelocity();

    const newBody = _makeBody(obj, pos.x, pos.y, type);
    if (!newBody) return;
    newBody.setTransform(pos, angle);
    if (type !== 'static') {
        newBody.setLinearVelocity(vel);
        newBody.setAngularVelocity(angVel);
    }

    _world.destroyBody(oldBody);
    entry.body       = newBody;
    obj._physicsBody = newBody;
}


// ── Re-export inspector functions so existing import paths work ───
export {
    buildPhysicsInspectorHTML,
    autoFitCollisionShape,
    bindPhysicsInspector,
    openPolygonEditor,
    snapshotPhysics,
    restorePhysics,
} from './engine.physics.inspector.js';
