/* GEOG 464 memory.js: let your Leaflet map remember what a reader adds.
   (c) 2026 Luke Russell. All rights reserved. Students may copy and adapt it for GEOG 464.

   HOW TO USE
   1. Save this file as memory.js in the same folder as your index.html.
   2. In index.html, AFTER the script that makes your map, add:
        <script src="memory.js"></script>
        <script>addMemory(map);</script>
      (use your own map variable's name if it is not "map").
   3. Change only the part marked CHANGE THIS PART below.

   TWO ROUTES, SAME CREDIT
   - Personal (default): points are saved in the reader's own browser (localStorage).
     They survive a reload; nobody else sees them. Nothing to set up.
   - Shared: paste your own Firebase web config below, publish the rules from the kit,
     and every reader sees every point within a second.
*/

// ===== CHANGE THIS PART =====
const MEMORY = {
  // What a reader can add. Colour plus words, never colour alone.
  // Each kind also has its own shape and symbol (triangle "!", square "✕", circle with a lightbulb),
  // and colours the bike lanes do not use, so a report never looks like a lane.
  categories: {
    observation:    { label: "Report route variability, construction issues",       colour: "#e66101", shape: "triangle" },
    problem: { label: "Something is wrong",    colour: "#b80000", shape: "square" },
    idea:    { label: "Input ideas or suggestions",    colour: "#7b3294", shape: "circle" }
  },
  maxNote: 80,                       // characters
  // Where points may go: south, north, west, east. null means anywhere.
  bounds: null,                      // e.g. { south: 45.40, north: 45.60, west: -73.75, east: -73.45 }
  storageKey: null,                  // personal route: null gives each page folder its own notebook
  position: "bottomleft",              // where the panel sits: topright, topleft, bottomright, bottomleft
  collection: "points",              // shared route: the Firestore collection name
  // Shared route only: paste your Firebase web config here. Leave apiKey as PASTE for the personal route.
  firebaseConfig: {
    apiKey: "AIzaSyA2O28kwhisqJvCBkCNa_Qq7wdFuYRz0mM",
    authDomain: "montreal-bicycle-network.firebaseapp.com",
    projectId: "montreal-bicycle-network",
    appId: "1:783311647601:web:4ac2b88adbe762f0247cd0"
  }
};
// ===== END OF THE PART TO CHANGE =====

const MEMORY_SDK = "https://www.gstatic.com/firebasejs/12.18.0/";   // pinned version

// The drawing for one kind of point, at a given size in pixels: its shape and white symbol in its colour.
// Used for the points on the map and for the key in the panel, so the two always match.
function memoryIcon(c, size) {
  const shapes = {
    triangle: '<path d="M12 2 L23 21 H1 Z" fill="' + c.colour + '" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>' +
      '<path d="M12 9v5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.3" fill="#fff"/>',
    square: '<rect x="2" y="2" width="20" height="20" rx="3" fill="' + c.colour + '" stroke="#fff" stroke-width="1.5"/>' +
      '<path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>',
    circle: '<circle cx="12" cy="12" r="10.5" fill="' + c.colour + '" stroke="#fff" stroke-width="1.5"/>' +
      '<path d="M10 17.5h4M10.5 19.5h3M12 5.5a4.5 4.5 0 0 0-2.8 8c.5.5.8 1.1.8 1.8v.7h4v-.7c0-.7.3-1.3.8-1.8a4.5 4.5 0 0 0-2.8-8z" ' +
      'fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  // A kind with no shape (or a point whose kind is unknown) is a plain circle
  const shape = shapes[c.shape] || '<circle cx="12" cy="12" r="10" fill="' + c.colour + '" stroke="#fff" stroke-width="1.5"/>';
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" focusable="false" ' +
    'style="display:block;overflow:visible;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.5))">' + shape + '</svg>';
}

function addMemory(map) {
  const shared = !String(MEMORY.firebaseConfig.apiKey).startsWith("PASTE");
  // Your github.io projects share one browser storage area, so each page folder gets its own key.
  const storageKey = MEMORY.storageKey || ("geog464-memory:" + location.pathname.replace(/[^/]*$/, ""));
  const layer = L.layerGroup().addTo(map);
  let points = [];       // {id, lat, lng, cat, note, uid, ts}
  let adding = false;    // "Add a point" mode: the next click on the map adds a point
  let myUid = "me";
  let fb = null;         // Firebase functions, shared route only

  // ---------- a small panel on the map ----------
  const Panel = L.Control.extend({
    onAdd() {
      const box = L.DomUtil.create("div", "memory-panel");
      box.style.cssText = "background:#fff;padding:8px 10px;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.35);font:14px Arial,sans-serif;max-width:230px";
      // Folded at the start: one "Report or suggest" button and the status line (always visible, so messages
      // and errors are never hidden). Pressing the button opens the rest: Add a point, the key and Download.
      box.innerHTML =
        '<button type="button" data-m="toggle" aria-expanded="false" aria-controls="memory-panel-body" ' +
          'style="width:100%;min-height:40px;font-weight:bold;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px">' +
          memoryIcon(Object.values(MEMORY.categories)[0], 16) + 'Report or suggest</button>' +
        '<div data-m="status" role="status" style="margin:6px 0 0">Loading...</div>' +
        '<div id="memory-panel-body" data-m="body" hidden style="margin-top:8px">' +
          '<button type="button" data-m="add" style="width:100%;min-height:40px;font-weight:bold;cursor:pointer">Add a point</button>' +
          '<ul data-m="legend" style="list-style:none;margin:6px 0;padding:0"></ul>' +
          '<button type="button" data-m="export" style="width:100%;cursor:pointer">Download points (GeoJSON)</button>' +
        '</div>';
      L.DomEvent.disableClickPropagation(box);
      return box;
    }
  });
  const panel = new Panel({ position: MEMORY.position || "topright" }).addTo(map).getContainer();
  const $ = (k) => panel.querySelector('[data-m="' + k + '"]');
  for (const c of Object.values(MEMORY.categories)) {
    const li = document.createElement("li");
    const sw = document.createElement("span");
    sw.style.cssText = "display:inline-block;vertical-align:middle;margin-right:6px";
    sw.innerHTML = memoryIcon(c, 14);   // the same shape as on the map (only the author's settings go in here)
    li.append(sw, document.createTextNode(c.label));
    $("legend").append(li);
  }
  function status(text) { $("status").textContent = text; }

  // "Report or suggest" opens and closes the rest of the panel
  $("toggle").addEventListener("click", () => {
    const opening = $("body").hidden;
    $("body").hidden = !opening;
    $("toggle").setAttribute("aria-expanded", String(opening));   // tells screen readers whether it is open
  });

  function draw() {
    layer.clearLayers();
    for (const p of points) {
      const c = MEMORY.categories[p.cat] || { colour: "#666", label: "" };
      // A small HTML icon in the shape of its kind (it can also be reached with the Tab key)
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: "memory-icon", html: memoryIcon(c, 22), iconSize: [22, 22] }),
        title: c.label
      }).bindPopup(() => popup(p)).addTo(layer);
    }
    status((shared ? "Shared: " : "Saved in this browser: ") + points.length + " point" + (points.length === 1 ? "" : "s"));
  }

  // A reader's note is typed by a stranger: show it with textContent, never innerHTML.
  function popup(p) {
    const box = document.createElement("div");
    const h = document.createElement("strong");
    h.textContent = (MEMORY.categories[p.cat] || { label: p.cat }).label;
    const n = document.createElement("div");
    n.textContent = p.note || "(no note)";
    box.append(h, n);
    if (!shared || p.uid === myUid) {
      const del = document.createElement("button");
      del.type = "button"; del.textContent = "Delete my point"; del.style.marginTop = "6px";
      del.addEventListener("click", () => remove(p.id));
      box.append(del);
    }
    return box;
  }

  // ---------- personal route: localStorage ----------
  function loadLocal() {
    try { points = JSON.parse(localStorage.getItem(storageKey) || "[]"); }
    catch (e) { points = []; }
    draw();
  }
  function saveLocal() {
    try { localStorage.setItem(storageKey, JSON.stringify(points)); return true; }
    catch (e) { status("This browser would not save it (private mode?)"); return false; }
  }

  // ---------- shared route: Firebase ----------
  async function startShared() {
    status("Connecting...");
    try {
      const app = await import(MEMORY_SDK + "firebase-app.js");
      const fs = await import(MEMORY_SDK + "firebase-firestore.js");
      const au = await import(MEMORY_SDK + "firebase-auth.js");
      const fapp = app.initializeApp(MEMORY.firebaseConfig);
      const db = fs.getFirestore(fapp);
      const auth = au.getAuth(fapp);
      await au.signInAnonymously(auth);            // a random, anonymous id for this browser
      myUid = auth.currentUser.uid;
      fb = { fs, db };
      const q = fs.query(fs.collection(db, MEMORY.collection), fs.orderBy("ts", "desc"), fs.limit(500));
      fs.onSnapshot(q, (snap) => {
        points = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        draw();
      }, (err) => status("The database said no: " + (err.code || err.message)));
    } catch (err) {
      console.error(err);
      status("Could not reach the database: " + (err.code || err.message));
    }
  }

  // ---------- adding and removing ----------
  function inside(lat, lng) {
    const b = MEMORY.bounds;
    return !b || (lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east);
  }

  async function add(lat, lng, cat, note) {
    note = (note || "").trim().slice(0, MEMORY.maxNote);
    lat = Math.round(lat * 1e5) / 1e5; lng = Math.round(lng * 1e5) / 1e5;   // about 1 m
    if (!inside(lat, lng)) { status("That is outside this map's area"); return; }
    if (!MEMORY.categories[cat]) { status("Choose a kind of point"); return; }
    if (shared) {
      if (!fb) { status("Not connected yet"); return; }
      try {
        await fb.fs.addDoc(fb.fs.collection(fb.db, MEMORY.collection),
          { lat, lng, cat, note, uid: myUid, ts: fb.fs.serverTimestamp() });
      } catch (err) {
        status(err.code === "permission-denied" ? "The rules said no" : "Not saved: " + (err.code || err.message));
      }
    } else {
      points.unshift({ id: "p" + Date.now(), lat, lng, cat, note, uid: "me", ts: Date.now() });
      if (saveLocal()) draw(); else points.shift();   // not saved: do not pretend it was
    }
  }

  async function remove(id) {
    map.closePopup();
    if (shared) {
      try { await fb.fs.deleteDoc(fb.fs.doc(fb.db, MEMORY.collection, id)); }
      catch (err) { status("Not deleted: " + (err.code || err.message)); }
    } else {
      const before = points;
      points = points.filter((p) => p.id !== id);
      if (saveLocal()) draw(); else points = before;   // not deleted: keep showing it
    }
  }

  // "Add a point" switches on adding for ONE click. While it is on, memory.js catches that click
  // before Leaflet sees it, so your map's own click actions (nearest place, popups) do not also fire.
  function setAdding(on) {
    adding = on;
    $("add").textContent = on ? "Now click the map (or press again to cancel)" : "Add a point";
    map.getContainer().style.cursor = on ? "crosshair" : "";
  }
  $("add").addEventListener("click", () => setAdding(!adding));

  map.getContainer().addEventListener("click", (ev) => {
    if (!adding) return;
    if (ev.target.closest(".leaflet-control, .leaflet-popup")) return;   // clicks on panels and popups pass through
    ev.stopPropagation();                    // your other map click handlers do not run for this click
    setAdding(false);
    openForm(map.mouseEventToLatLng(ev));
  }, true);                                  // true = catch it on the way in, before Leaflet

  function openForm(latlng) {
    const form = document.createElement("form");
    const sel = document.createElement("select");
    sel.setAttribute("aria-label", "What kind of point?");
    for (const [k, c] of Object.entries(MEMORY.categories)) {
      const o = document.createElement("option"); o.value = k; o.textContent = c.label; sel.append(o);
    }
    const inp = document.createElement("input");
    inp.maxLength = MEMORY.maxNote; inp.placeholder = "Short note, no names"; inp.setAttribute("aria-label", "Short note");
    inp.style.cssText = "display:block;margin:6px 0;width:100%";
    const ok = document.createElement("button"); ok.type = "submit"; ok.textContent = "Save";
    form.append(sel, inp, ok);
    form.addEventListener("submit", (ev) => { ev.preventDefault(); map.closePopup(); add(latlng.lat, latlng.lng, sel.value, inp.value); });
    L.popup().setLatLng(latlng).setContent(form).openOn(map);
    setTimeout(() => sel.focus(), 50);
  }

  // ---------- download what is on the map ----------
  $("export").addEventListener("click", () => {
    const gj = { type: "FeatureCollection", features: points.map((p) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { category: (MEMORY.categories[p.cat] || { label: p.cat }).label, note: p.note } })) };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(gj, null, 2)], { type: "application/geo+json" }));
    a.download = "points.geojson"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  if (shared) startShared(); else loadLocal();
  return { get points() { return points; }, get shared() { return shared; } };   // handy for testing
}