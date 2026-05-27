# Team Navigator — guía para Claude (o cualquiera que toque el código)

Este documento existe para que la próxima sesión (probablemente Claude otra
vez) entienda la estructura sin tener que redescubrirla. Si vas a tocar
algo, **léelo entero antes**.

---

## 1. Qué es esta app

Team Navigator es una app de **gestión de tareas y roadmaps** para el equipo
de Bookline. Single-page, sin build step, deploy estático a GitHub Pages.
Auth con Google vía Supabase. Datos persistidos en `localStorage` + sync a
`user_stores` de Supabase (un row por usuario).

- **Repo:** `BooklineBerni/team-navigator` (privado)
- **URL pública:** `https://booklineberni.github.io/team-navigator/`
- **Admin email:** `bernat@bookline.ai` (hard-coded fallback)
- **Permisos:** admin / restricted_view / none (tabla `user_permissions`)

---

## 2. Estructura del repo

```
data/
  team-directory.js         ← TEAM, EXTERNAL_TEAM, SLACK_DIRECTORY (constantes)
  holidays.js               ← HOLIDAYS constant (Spain national + Catalonia + Barcelona, 2025-2027)

styles/
  app.css                   ← TODO el CSS

lib/                        ← infraestructura compartida
  supabase-auth.js          ← auth gate + sync con cloud
  permissions.js            ← admin allowlist + preview-as
  filters.js                ← predicados unificados (window.BNFilters)
  date-picker.js            ← popover de fecha custom (hijack de <input type=date>)
  files-integration.js      ← Drive link parsing + Google Picker OAuth + Team Files sync
  requests-feature.js       ← Slack requests fetch/decrypt + notifications + helpers
  pickers.js                ← Proposed-by + Responsible + Custom colored picklist + Group helpers
  bulk-popovers.js          ← Popovers de bulk-bar (multi-roadmap, multi-proposed-by, set-parent)
  trash.js                  ← Soft-delete: bnSoftDeleteTask, bnRestoreFromTrash, bnRenderTrashPage
  backup.js                 ← Rolling snapshots + Export + Import preview + Rollback helper

views/                      ← un archivo por vista del sidebar
  home.js                   ← renderHomePage
  files.js                  ← renderFilesPage
  requests.js               ← renderRequestsPage
  tasks.js                  ← renderFlatTasks (vista lista)
  team.js                   ← renderMembersPage
  profile.js                ← Profile completo: renders + helpers + estado
  roadmaps.js               ← renderRoadmapsTimelinePage (delgado, llama al calendar)
  roadmap-calendar.js       ← renderRoadmapCalendar (1700 líneas: Gantt completo)
  bulk-create.js            ← modal Bulk Create (Stage 1 + Stage 2)
  modals/
    person-tags.js          ← Person tags modal
    add-member.js           ← Add Member modal (Slack search)
    tag-manager.js          ← renderTaskTagsInModal (in-task tag rendering)
    subtasks-panel.js       ← Subtasks panel for group tasks
    task-tag-manager.js     ← Task Tag Manager + global Tag Manager

tests/
  smoke.spec.js             ← Playwright smoke test (corre en CI cada push)
playwright.config.js        ← config del test (sirve estático con python -m http.server)
package.json                ← solo @playwright/test, no hay build step

index.html                  ← núcleo + boot. Ahora ~6.270 líneas tras todas las
                              extracciones. Contiene STORE, auth bootstrap,
                              tag library helpers, anchor/date helpers, capa
                              de orquestación (render() central + filtros),
                              task modal (openModal/closeModal), task schedule
                              sidebar, roadmap modal-edit (renderRoadmapsList
                              etc.), holidays helpers.

supabase/migrations/        ← schemas SQL (aplican vía GH Actions)
.github/workflows/
  smoke-test.yml            ← corre el smoke test cada push (NUEVO)
  supabase-migrations.yml   ← aplica migrations
  sync-requests.yml         ← Slack → requests.json
requests.json               ← cache de requests sincronizadas desde Slack
team-files.json             ← cache de archivos compartidos del equipo
README.md                   ← landing (mínimo, no contiene arquitectura)
CLAUDE.md                   ← este archivo
```

---

## 3. Cómo se cargan los scripts (importante)

Orden en `index.html` `<head>`:

```html
<!-- 1. CDN -->
<script src="https://apis.google.com/js/api.js" async defer></script>
<script src="https://accounts.google.com/gsi/client" async defer></script>

<!-- 2. mini-inline para anti-flash CSS en OAuth callback -->
<script>...</script>

<!-- 3. Supabase SDK -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.0/...">

<!-- 4. Datos + lib + filters + auth + permisos. SIEMPRE antes del inline. -->
<script src="data/team-directory.js"></script>
<script src="lib/supabase-auth.js"></script>
<script src="lib/permissions.js"></script>
<script src="lib/filters.js"></script>

<!-- 5. EL inline gigante con STORE, helpers, modales, render() central. -->
<script>
  // ~8.800 líneas
</script>

<!-- 6. Vistas + componentes que pueden cargar después. -->
<script src="views/bulk-create.js"></script>
<script src="views/home.js"></script>
<script src="lib/files-integration.js"></script>      ← antes de views/files.js
<script src="views/files.js"></script>
<script src="lib/requests-feature.js"></script>       ← antes de views/requests.js
<script src="views/requests.js"></script>
<script src="views/tasks.js"></script>
<script src="views/team.js"></script>
<script src="views/profile.js"></script>
<script src="lib/date-picker.js"></script>
<script src="views/modals/person-tags.js"></script>
<script src="views/modals/add-member.js"></script>
<script src="views/modals/tag-manager.js"></script>
<script src="views/modals/subtasks-panel.js"></script>
<script src="views/modals/task-tag-manager.js"></script>
<script src="views/roadmap-calendar.js"></script>      ← antes de views/roadmaps.js
<script src="views/roadmaps.js"></script>

<!-- 7. Re-render final (las vistas ya están definidas para entonces). -->
<script>if (typeof render === 'function') { try { render(); } catch (_) {} }</script>
```

**Reglas de orden de carga importantes:**
- `lib/files-integration.js` antes que `views/files.js` (renderFilesPage usa
  bnUpdateFilesBadge, fileIconForType, detectFileType).
- `lib/requests-feature.js` antes que `views/requests.js` (renderRequestsPage
  usa bnPendingRequests, rqCardHtml).
- `views/roadmap-calendar.js` antes que `views/roadmaps.js` (la reasignación
  en roadmaps.js no la necesita en parse time pero queda más limpio así).

**Reglas críticas de orden:**

- `data/team-directory.js` define `const TEAM`, `EXTERNAL_TEAM`,
  `SLACK_DIRECTORY` — **DEBE cargar antes del inline** porque el inline
  lee esas constantes durante su parse.
- `lib/*.js` también cargan antes del inline porque `lib/supabase-auth.js`
  inicia el flujo de auth, y `lib/filters.js` provee `window.BNFilters` que
  el inline llama desde sus filtros.
- `views/*.js` cargan **después del inline** porque referencian (en sus
  cuerpos de función, no en top-level) variables `let`-scoped del inline
  como `STORE`, `currentView`, etc.

**Por qué el orden de los `lib/` vs `views/` es así:**
classic scripts en el mismo realm comparten el "script scope record" para
`let`/`const`/`function`. Las **declaraciones de función top-level** en
cualquier script clásico SÍ van también a `window`. Las `let`/`const`
top-level **NO van a `window`** pero SÍ son visibles desde otros classic
scripts (en el mismo script scope record), siempre que el script que las
declara haya ejecutado ya. Por eso views/*.js cargan después de inline:
sus funciones cierran sobre `STORE` (declarado `let` en inline), y se
resuelve en runtime cuando el usuario interactúa, no en parse time.

---

## 4. Patrones que usamos (síguelos)

### 4.1 Extraer una vista nueva

Si quieres mover una sección del inline a su propio archivo:

1. **Encontrar el bloque contiguo.** Asegúrate de que tiene una frontera
   limpia (un `// ----` header al inicio, blank line al final).
2. **Comprobar callers externos.** `grep -n "funcionName" index.html`.
   - Si los callers están **dentro de funciones** (event handlers, etc.),
     OK — el lookup es en runtime.
   - Si hay callers en **top-level** del inline (módulo-scope), o pasados
     como argumentos a `setTimeout(fn, ms)` directamente — **PROBLEMA**.
     Conviértelos a arrow wrappers: `setTimeout(() => fn(), ms)`.
3. **Crear `views/foo.js`** (o `lib/foo.js` para infraestructura) con un
   header doc-comment explicando dependencias.
4. **Sin IIFE.** Funciones top-level → van automáticamente a `window`.
   Si envolvemos en IIFE, perdemos eso y romperíamos los call-sites.
5. **Reemplazar el bloque en inline** por un placeholder comment **sin
   `</script>` literal dentro** (HTML parser cierra el `<script>` ahí
   aunque sea JS válido — esto ya nos mordió en el Paso 6, ojo).
6. **Añadir el `<script src>`** en `index.html` después del inline.
7. **Guard con `typeof`** todos los call-sites desde el inline central
   `render()`:
   ```js
   if (typeof renderFooPage === 'function') renderFooPage();
   ```
   Esto evita el ReferenceError durante el boot inicial cuando inline
   llama a `render()` antes de que cargue `views/foo.js`.
8. **Validar JS** antes de deployar:
   ```bash
   # Extrae el inline y valida que parsea
   node -e "new Function(require('fs').readFileSync('/tmp/inline.js','utf8'))"
   # Y el archivo nuevo
   node -e "new Function(require('fs').readFileSync('views/foo.js','utf8'))"
   ```

### 4.2 Trampa famosa: `</script>` dentro de comentarios

```js
// FALSO: esto rompe el HTML
// Foo moved to views/bar.js (loaded after this </script>).
```

El HTML parser ve `</script>` y cierra el tag inline ahí, dejando la mitad
del JS fuera del script. Pasó en Paso 6, costó un debug largo. **Nunca
escribas la cadena literal `</script>` en JS** — usa "</ script>" con
espacio, o "the script below", o cualquier otra cosa.

### 4.3 Patrón para state inline + funciones extraídas

El inline declara filter state con `let`:

```js
// inline
let statusInclude = new Set(), statusExclude = new Set(), …
```

Las funciones en `lib/filters.js` no pueden leer `statusInclude` directamente
(no está en window). Solución: el inline expone `bnGetFilterState()` que
construye un snapshot:

```js
// inline
function bnGetFilterState() {
  return { statusInclude, statusExclude, /* … */ };
}
```

Y `BNFilters.allFiltersOK(task, bnGetFilterState())` lo recibe.

Si quieres compartir state entre múltiples archivos extraídos, usa este
patrón. No metas todos los `let`s en window — saturarías el namespace.

### 4.4 Deploy

```bash
# 1. Clone fresco (o reutiliza /tmp/berni-deploy)
git clone https://github.com/BooklineBerni/team-navigator.git /tmp/berni-deploy

# 2. Copia index.html + archivos nuevos
cp /Users/bernibookline/Downloads/index.html /tmp/berni-deploy/index.html
cp /Users/bernibookline/Downloads/views/foo.js /tmp/berni-deploy/views/foo.js

# 3. Commit + push
cd /tmp/berni-deploy
git add .
git commit -m "Refactor: ..."
git pull --rebase origin main  # por si GH Actions metió un commit
git push origin main

# 4. Esperar ~30s (CDN de Pages)
# 5. Verificar en Chrome con cb param: ?cb=XXX para forzar reload
```

### 4.5 Verificación post-deploy

Siempre comprobar en Chrome:

```js
// En consola del navegador:
JSON.stringify({
  // Funciones movidas deben existir
  foo: typeof window.renderFooPage,
  // El STORE sigue ahí
  visible: window.visibleTasksCount(),
  // Cero errores
  // (mirar la pestaña Console)
})
```

---

## 5. Lo que está en `index.html` y por qué se queda ahí

`index.html` sigue teniendo **~8.800 líneas**. Sé honesto sobre por qué:

| Bloque | Líneas aprox. | Por qué no extraerlo |
|--------|---------------|----------------------|
| HTML markup (header, sidebar, modales, sections) | ~870 | Es HTML, no JS |
| STORE management (load/save/migrations) | ~200 | Corre al parse. Si lo mueves, STORE no existe cuando inline lo usa |
| Auth bootstrap callback | ~100 | Idem — corre al parse |
| `render()` central + dispatcher | ~80 | Necesita ver TODAS las render funciones. Su típeof guards las saltan limpiamente si no están cargadas aún |
| Filter pills + counts + sort | ~700 | Acoplado a `render()` y a la UI de filtros. Mover esto requiere mover render también |
| Modales (Person tags, Add Member, Task Tag Manager, Subtasks panel, Roadmaps assignment) | ~600 | Cada uno entrelazado con eventos del task modal. Extraíble pero alto riesgo |
| Pickers (Proposed-by, Responsible, Custom colored picklist) | ~700 | Componentes UI, pero comparten state con el resto |
| Task schedule sidebar (Start/End synced con roadmaps) | ~1030 | Capa de fechas/anchors muy entrelazada |
| Anchor resolution (`effectiveDatesForTask`, `bnPropagateAnchorChanges`, etc) | ~740 | **Crítico — NO mover.** Usado en 30+ sitios |
| Date utils (`parseDate`, `addDays`, `DAY_MS`) | ~10 | Idem, usado en código top-level |
| Holidays | ~80 | Constantes, podría irse pero da igual |
| Boot/init code (DOMContentLoaded wirings) | ~200 | Por definición es el inline |
| Bulk operations (bulk-bar, "nest under parent", popovers) | ~300 | Vinculado a `selectedTaskIds` y al render central |
| Files (Drive integration) | ~600 | Self-contained pero usa OAuth tokens del auth flow |
| Requests (Slack sync) | ~250 | Idem |
| Google Picker integration | ~110 | Idem |
| Team files cross-device sync | ~250 | Idem |

**Candidatos restantes a extracción** (no urgentes):

- `views/modals/`: cada modal a su archivo (~600 líneas, riesgo medio)
- `views/roadmap-edit.js`: el modal-edit de roadmap (~780 líneas en `// ---- Roadmaps ----`, riesgo medio-alto)
- `views/files-integration.js`: Files + Google Picker + Team files sync (~970 líneas, riesgo medio)
- `lib/pickers.js`: componente custom-colored-picklist + responsible + proposed-by (~700 líneas, riesgo medio)

Si en una sesión futura abordas alguno de estos, **antes de empezar**:

1. `grep -n "nombreFuncion" index.html` y mira cuántos callers externos hay.
2. Si hay top-level callers, conviértelos a arrow wrappers / typeof guards
   ANTES de mover nada.
3. Mueve UN bloque por commit, verifica en Chrome, sigue.

---

## 6. Gotchas conocidas

### 6.1 `let`/`const` top-level NO están en `window`

```js
let foo = 1;
console.log(window.foo);   // undefined !!
console.log(foo);          // 1
```

Pero `function` top-level SÍ va a `window`. Por eso `renderFooPage` se
puede llamar desde otro `<script src>` pero `STORE` no aparece como
`window.STORE` aunque sí es legible si haces `STORE.tasks` desde
cualquier classic script del mismo realm que haya cargado después del que
la declaró.

### 6.2 Reasignación dispara double-declaration

```js
// inline
function foo() { /* impl 1 */ }
// views/foo.js
function foo() { /* impl 2 */ }   // SyntaxError si parse fail, o silently replaces
```

Si tienes una función con el mismo nombre declarada con `function` en
dos classic scripts, el segundo gana SILENCIOSAMENTE. Cuidado.

### 6.3 `setTimeout(fn, ms)` resuelve `fn` inmediatamente

```js
setTimeout(renderMembersPage, 120);   // resuelve YA
setTimeout(() => renderMembersPage(), 120);   // resuelve cuando salta
```

Si la función se extrajo a otro archivo que carga después, **siempre**
usa el arrow wrapper.

### 6.4 `onclick="foo()"` en HTML ata a globals

Hay varios `<button onclick="closeRoadmapsList()">` en el HTML. Esto
requiere que `closeRoadmapsList` esté en `window`. Como las
function-declarations top-level lo están, funciona. Pero si refactorizas
`closeRoadmapsList` para que viva en una IIFE, dejará de funcionar
silenciosamente. **No envuelvas funciones referenciadas desde HTML en
IIFEs.**

### 6.5 La barra de bulk se actualiza en `updateBulkBar()`

Si añades una acción nueva al modo bulk (botón en la barra), tienes que
también populá el dropdown en `updateBulkBar()` para que aparezca con
opciones frescas cuando seleccionas tasks.

### 6.6 Los filtros son "tristate"

Cada filtro (status, prio, type, taskTag, roadmap, dateStatus) tiene
**dos Sets**: `xxxInclude` y `xxxExclude`. Cycle: nada → include → exclude
→ nada. Si añades un filtro nuevo:

1. Declara `let fooInclude = new Set(), fooExclude = new Set()` en inline.
2. Añade `fooOK(t, state)` en `lib/filters.js`.
3. Llámalo en `allFiltersOK` con su `skip` dim.
4. Añade `fooInclude`, `fooExclude` al objeto que devuelve `bnGetFilterState`.
5. Persistirlo en `saveFilterState` / `loadFilterState`.

---

## 7. Cómo añadir features comunes

### 7.1 Añadir una vista nueva al sidebar

1. Añade HTML en `index.html` con id `view-foo`.
2. Añade link en el sidebar (busca `nav-tasks` para el patrón).
3. Crea `views/foo.js` con `function renderFooPage() { ... }`.
4. Añade el `<script src="views/foo.js">` al final de `index.html`.
5. En el `render()` central de inline, añade:
   ```js
   if (currentView === "foo") {
     if (typeof renderFooPage === 'function') renderFooPage();
     return;
   }
   ```
6. Verifica en Chrome.

### 7.2 Añadir un campo nuevo a las tasks

1. Declara el default en el constructor de tasks (busca dónde se crea una
   task nueva: `_createdLocal` ayuda).
2. Si es persistible: ya está, va al STORE.
3. Si quieres filtrarlo: sigue 6.6.
4. Si quieres mostrarlo: edita `taskHtml(t)` (en inline) + el modal task.
5. Si quieres editarlo en bulk: edita `bnBulkSave` (views/bulk-create.js).

### 7.3 Añadir un permiso nuevo

1. Crea migration en `supabase/migrations/` definiendo el nuevo nivel.
2. Actualiza `lib/permissions.js` para mostrarlo en el admin UI.
3. Actualiza el inline `render()` y los wirings que dependen de él.
4. Push: GH Actions aplica la migration y deploya.

---

## 7b. Pulido futuro pendiente (descartado por bajo ROI ahora)

Estas mejoras tienen valor real pero no las hago hasta que la app crezca:

1. **Tests E2E por feature** — hoy el smoke test cubre "no peta + crear task con
   Bulk". Faltan: filtros reducen el visible-count correctamente, mover task
   entre roadmaps, expand/collapse group, drag-drop en el calendar. 20-30 líneas
   de Playwright por test.

2. **Memoizar `bnGetFilterState`** — devuelve objeto nuevo en cada call. Si
   filter state no cambia, se podría cachear el snapshot.

3. **Migrar 17 `onclick="..."` HTML a `addEventListener` + después IIFE** — primero
   hay que desatar el HTML de los nombres globales, luego se puede encapsular
   con IIFE para reducir el global namespace.

4. **Bundle minify** — GH Pages ya sirve con gzip; minificar destruiría el grep,
   así que solo vale si llegamos a un build step.

5. **`app.css` split por componente** — `modals.css`, `calendar.css`, etc.
   Cero impacto funcional, solo organización.

## 8. Deuda técnica reconocida

- **`index.html` sigue grande (~7.400 líneas).** Los candidatos para
  futura extracción están en la sección 5.
- **✅ Hay smoke test automático** (Playwright + GH Actions, corre cada
  push a main). Si el test falla, el deploy debe considerarse inseguro.
  Si añades una función global crítica, considera añadir su verificación
  al `tests/smoke.spec.js`.
- **No hay build step.** Bueno para simplicidad pero significa que
  tampoco hay minification, tree-shaking, ni TypeScript. Cuando el
  código crezca >50k líneas considera Vite/esbuild + ESM.
- **Globals everywhere.** El refactor a IIFE para algunos archivos
  rompería call-sites en HTML (`onclick="..."`). Si quieres encapsular,
  primero migra todo el HTML a `addEventListener` desde JS, luego IIFE.
- **STORE es por-usuario, no colaborativo.** Si dos personas editan la
  misma task simultáneamente, el último que guarda gana. No hay
  realtime. Para colaboración de verdad: ver section "next steps" abajo.

---

## 9. Próximos hitos (en orden de impacto)

1. **Toggle Private en tasks/tags/roadmaps** (task #138 pendiente).
   Pequeño pero útil. Implementa un boolean `t.isPrivate` y un filtro de
   visibilidad por usuario actual.

2. **STORE compartido / colaborativo.** Mayor cambio. Pasos:
   - Crear tabla `shared_store` en Supabase con un row único (o pocos rows
     por "workspace"). Ya está el schema esbozado en
     `supabase/migrations/`.
   - Cambiar `bnSyncPullFromCloud` para leer de `shared_store` en vez de
     `user_stores`.
   - Cambiar `bnSyncPushToCloud` para upsert al shared_store.
   - Activar Supabase Realtime para que cambios de otros usuarios se
     propaguen. Suscribirse a la tabla y `render()` cuando llegue evento.
   - Resolver conflictos: probablemente "last write wins" inicial; más
     adelante operational transform o CRDT si hace falta.

3. **Tests automáticos.** Un GH Action que carga `index.html` en
   Playwright, espera 10s, comprueba que `STORE.tasks.length > 0`,
   `render()` no lanza, y los smoke-clicks de cada tab.

4. **Migrar `onclick="..."` HTML a `addEventListener`.** Permite IIFE de
   verdad y reduce el global namespace.

---

## 10. Comandos útiles

```bash
# Validar JS del inline (extrae el contenido del <script> y lo parsea con Node)
python3 -c "
import re
html = open('index.html').read()
m = sorted([(re.finditer(r'<script>\n', html), re.finditer(r'\n</script>', html))], key=...)
# ... (ver Paso 6 commit para el script completo)
" | node -e "new Function(require('fs').readFileSync('/dev/stdin','utf8'))"

# Validar un view/lib extraído
node -e "new Function(require('fs').readFileSync('views/foo.js','utf8')); console.log('OK')"

# Buscar callers externos de una función antes de moverla
grep -n "nombreFuncion" index.html | head -20

# Contar líneas de cada archivo
wc -l index.html lib/*.js views/*.js data/*.js

# Ver historia de un archivo
git log --oneline -- views/profile.js
```

---

## 11. Convenciones de naming

- `bn` prefix: helpers de Team Navigator que pueden colisionar con cosas
  estándar (ej. `bnParseDate` no choca con la `Date.parse` nativa).
- `BN_` prefix: constantes globales (BN_SUPABASE_URL, BN_DP, BN_AUTH_REQUIRED).
- `render*Page` / `renderFlatTasks` / `renderTeamStrip`: funciones que
  pintan UI completa de una sección.
- `wire*`: funciones que **añaden event listeners** después de un render.
  Casi siempre se llaman al final del `render*` correspondiente.
- `build*`: funciones que devuelven HTML como string (no tocan DOM).
- `_underscorePrefix`: helpers "privados" (no es enforcement, es convención).
- `taskMatches*`, `personMatches*`: predicados booleanos.

---

## 12. Esta sesión (resumen para continuidad)

El refactor completo en esta sesión:

- **Antes:** `index.html` 18.121 líneas en un solo archivo.
- **Ahora:** `index.html` ~7.400 líneas + 20+ archivos externos
  organizados por responsabilidad + smoke test en CI.

Pasos numerados (commits en `main`):

1. Paso 1: data/team-directory.js
2. Paso 2: styles/app.css
3. Paso 3: lib/supabase-auth.js
4. Paso 4: lib/permissions.js
5. Paso 5: lib/filters.js (con deduplicación de predicados)
6. Paso 6: views/bulk-create.js (1413 líneas)
7. Paso 7a: views/home.js, files.js, requests.js, tasks.js
8. Paso 7c: views/profile.js (977 líneas)
9. Paso 7d: views/team.js (con fix de late-binding setTimeout)
10. Paso 7e: views/roadmaps.js (delgado)
11. Paso 7f: views/roadmap-calendar.js (1700 líneas, el más gordo)
12. Cleanup: monkey-patch eliminado en views/roadmaps.js
13. Extra: lib/date-picker.js
14. Extra: views/modals/ (5 archivos, ~620 líneas)
15. Extra: lib/files-integration.js (Drive + Picker + Team sync, 616 líneas)
16. Extra: lib/requests-feature.js (Slack ingest + decrypt + notifications, 164 líneas)
17. Extra: smoke test con Playwright + GH Action en cada push

Decisiones clave que **NO debes revertir** sin pensarlo dos veces:

- Mantener `parseDate`/`addDays`/`DAY_MS` en inline.
- Mantener anchor helpers (`effectiveDatesForTask`,
  `bnPropagateAnchorChanges`, etc.) en inline.
- Mantener `render()` central + capa de filtros/counts en inline.
- `views/*.js` y `lib/*-integration.js` cargan después del inline.
- Usar `typeof renderXxx === 'function'` guard en `render()` central.
- No usar IIFE en archivos extraídos (rompería call-sites globales).
- Antes de mover algo nuevo: `grep -n` para call-sites top-level. Si
  los hay, conviértelos a arrow wrappers PRIMERO.

---

Si llegas hasta aquí, ya sabes todo. Ahora ponte a trabajar 🚀

---

## 13. Features añadidas después del refactor (chat May 2026)

Lista resumen del trabajo posterior al refactor base. Cada bullet incluye los
archivos clave y el comportamiento esperado para que el siguiente chat no
tenga que descubrirlo por sí mismo.

### 13.1 Joint Roadmaps view (admin-only)

`views/joint-roadmaps.js` (~280 líneas) + edits en `views/roadmaps.js`,
`views/roadmap-calendar.js`, `styles/app.css`.

- Toggle **Roadmaps / Joint** en el page header de la pestaña Roadmaps. La
  propia palabra "Roadmaps" es el segmento single; "Joint" es un pill al lado.
  Solo el admin live (no preview-as) ve el pill Joint.
- Joint mode = vista 6 MFN única que combina las tasks de los roadmaps
  seleccionados. Chips multi-select arriba con `All` / `None`.
- Si una task está en varios roadmaps seleccionados sale UNA vez con badges
  hue-stable (hash → HSL) indicando los roadmaps. Máximo 2 visibles + "+N".
- Estado persistido: `bn-joint-mode`, `bn-joint-selection`, `bn-joint-anchor`.
- Dispatcher en `renderRoadmapsTimelinePage()` decide joint vs single.
- `wireRoadmapsModeToggle()` ajusta el subtitle y oculta el pill para
  non-admins.

### 13.2 Linked Files desde el task modal

`lib/files-integration.js` (`bnPickDriveFileForTask`, `bnOpenGoogleDrivePickerWith`).

- Botón **+ Add file** al lado del label "Linked files" en el task modal.
  Click → abre el Google Drive Picker.
- Al elegir un file: si el URL ya existe en `STORE.driveFiles` se reusa
  añadiendo este taskId al `taskIds[]`; si es nuevo se crea entry con
  `sharedWith='team'`, type detectado.
- El listener se rebinda con clone en cada `openModal` para evitar dobles
  handlers. Read-only oculta el botón.
- `bnOpenGoogleDrivePickerWith(onPicked)` es ahora la primitiva genérica;
  la antigua `bnOpenGoogleDrivePicker` legacy la usa internamente.

### 13.3 Drag & drop de subtasks (intra-grupo + cross-group)

`lib/subtask-reorder.js` (nuevo, ~250 líneas).

- **Intra-grupo**: arrastra una subtask sobre otra del mismo grupo → reorder.
  Indicador: barra naranja arriba/abajo. Orden se persiste en
  `parent.subtaskOrder` (array de IDs). Helper `bnApplySubtaskOrder(parent,kids)`.
- **Cross-group**: arrastra una task sobre un grupo (cualquiera) → adopta
  ese grupo como nuevo parent (cambia `task.groupId`). Indicador: outline
  naranja dashed sobre el grupo entero. Funciona incluso si el grupo
  destino está colapsado.
- También puedes soltar en el área vacía debajo de un grupo expandido.
- Ciclos bloqueados por `bnWouldCreateGroupCycle()` (no puedes meter un
  grupo dentro de su propio descendiente).
- Funciona en: subtasks panel del modal, Tasks list view, by-person view.
- API expuesta en `window`: `bnApplySubtaskOrder`, `bnWireSubtaskReorder`,
  `bnWireAllRowsAsDragSources`, `bnWireTopLevelGroupDropTargets`,
  `bnMoveTaskToGroup`, `bnWouldCreateGroupCycle`.

### 13.4 Auto-refresh periódico desde Supabase

`lib/supabase-auth.js`: `bnStartAutoPullLoop`, `bnMaybeAutoPull`.

- Tras la auth gate arranca un `setInterval` cada 120s.
- Solo pulsa cuando: tab visible, no modal abierto, activeElement no es
  input/textarea/select/contenteditable, ≥60s desde el último pull, sin
  push pendiente debounced.
- `visibilitychange` también dispara un pull cuando vuelves a la pestaña.
- Sesiones abiertas todo el día se mantienen sincronizadas sin tocar nada.

### 13.5 Breadcrumb `↘ Parent` para tasks dentro de grupo no-matching

Edits en `views/tasks.js` y en el by-person renderer dentro de inline,
estilos en `styles/app.css` (`.bn-bc-row`, `.bn-bc-arrow`, `.bn-bc-name`).

- Cuando una task matches el filter pero su grupo padre NO, la task se
  promueve a top-level con una mini-fila `↘ NombreGrupo` encima por cada
  ancestro no-matching, anidadas.
- Si el ancestro no es visible por privacy → `↘ …` (sin nombre).
- Click en breadcrumb → abre el modal del grupo (no-op si no visible).
- `_bcChainFor(t)` y `_isPromotedToTop(t)` son los helpers locales en
  views/tasks.js; by-person tiene `_personBcChain` análogo dentro del
  inline.
- Aplica en Tasks list view + by-person.

### 13.6 Group puede anclar start/end a sus subtasks

Edit en `bnOpenAggregatedPicker()` en inline (line ~5127).

- Antes el filtro excluía `t.groupId === selfTaskId` (los hijos directos
  del grupo siendo editado). Quitado: ahora un grupo puede usar "start of
  <subtask>" o "end of <subtask>" como ancla.
- Cycle safety vía visited-set de `effectiveDatesForTask`.
- `bnPropagateAnchorChanges` propaga cambios de la subtask al grupo
  automáticamente.

### 13.7 Pills "start of X" / "end of X" refrescan nombre al renombrar source

Edits en `__refreshTaskDatesRowFromTask`, Quick-Apply panel load,
`bnRenderTaskAggBadge`, `bnDeriveSrcLabel`.

- Antes el label "start of OldName" se quedaba congelado en
  `t.startSrcLabel`. Ahora 4 sitios recomputan el label desde el subject
  actual del source task vía `startSrcTaskId` / `endSrcTaskId`.
- Es display-only: el campo persistido sigue stale hasta el próximo
  guardado, pero el usuario siempre ve el nombre correcto.

### 13.8 Fix: tasks ancladas no aparecen como Unscheduled

Edits en `effectiveDatesForTask` y `taskDateStatus` en inline.

- `effectiveDatesForTask` ahora también sigue el formato moderno
  (`startSrcTaskId` + `startSrcLabel`) como fallback cuando no hay
  `startAnchor` legacy. Resolución LIVE contra la source actual.
- `taskDateStatus` leía `r.start` / `r.end` (no existen — el objeto
  retorna `startStr` / `endStr`). Fix de una línea.
- Resultado: el filtro Dates: Unscheduled ya no muestra tasks que tienen
  fechas resolubles vía anchor moderno.

### 13.9 Fix: editar startDate ya no convierte endDate en pill "N days"

Edits en `autoSave` (×2) y `__refreshTaskDatesRowFromTask`.

- Antes autoSave persistía `durationDays` SIEMPRE que había start+end
  (porque daysEl mostraba el span como hint). En load, el pill "N days"
  se autoactivaba si `durationDays === cDays`. Combinado, cualquier task
  con dos fechas quedaba con duration-lock implícito.
- Ahora: `hasDays` requiere que la pill esté EXPLÍCITAMENTE activa
  (`endSrcLbl` matches `/^\d+\s+day/i`). El hint en daysEl no dispara
  duration-lock. Self-healing en first edit para tasks legacy.

### 13.10 Cross-group drag — UX en list y by-person

Ver 13.3. Resumen: drag de cualquier task a cualquier grupo cambia el
`groupId`. El subtaskOrder del antiguo padre se limpia, append al final
del nuevo. Render global tras drop.

### 13.11 Misc UI

- **Unscheduled del roadmap calendar plegable** (header + caret). Estado
  por roadmap en `localStorage['bn-rm-unscheduled-collapsed']`.
- **Personas independientes aunque estén en grupo**: en People page, los
  miembros de un custom group ahora aparecen TAMBIÉN como su propia
  card independiente (no solo como chip bajo el grupo).
- **Sección efectiva**: la card individual de una persona sigue SU
  propia sección, no la del grupo. Si Pau está en Supplementary y
  pertenece a un grupo en Team, su card sale en Supplementary.

---

## 14. Estado actual de archivos (post chat May 2026)

```
lib/
  subtask-reorder.js       ← NUEVO. Drag & drop de subtasks (250 líneas).

views/
  joint-roadmaps.js        ← NUEVO. Joint Roadmaps 6 MFN admin-only.

# Editados con cambios significativos:
lib/files-integration.js   ← + bnPickDriveFileForTask, bnOpenGoogleDrivePickerWith.
lib/supabase-auth.js       ← + auto-pull loop.
lib/filters.js             ← shareWithVisibilityOK, unassignedVisibilityOK.
views/tasks.js             ← Breadcrumb + drag wiring.
views/roadmap-calendar.js  ← Unscheduled plegable + tag refresh + summary card.
views/roadmaps.js          ← Joint dispatcher + wireRoadmapsModeToggle.
views/team.js              ← effectiveSection respeta sección propia.
views/modals/subtasks-panel.js ← Drag-reorder con handle visible.

index.html                 ← Página header de Roadmaps con toggle Roadmaps/Joint,
                              by-person renderer con breadcrumb, task modal
                              con + Add file, effectiveDatesForTask follow modern
                              anchor, taskDateStatus fix, autoSave fix de duration.
styles/app.css             ← Estilos para: bn-rm-mode-toggle, bn-joint-summary,
                              bn-joint-rm-pill, bn-bc-row, drag indicators,
                              rm-unscheduled-toggle caret.
```

## 15. Cache buster actual

`bn20260522r` (32 referencias en index.html). Cuando hagas un cambio,
bumpea la última letra (`bn20260522s` → `bn20260523a` cuando paseis del
día). El número del medio NO es la fecha real necesariamente.

---

Si llegas hasta aquí desde el chat May 2026, estás al día. Buena suerte.
