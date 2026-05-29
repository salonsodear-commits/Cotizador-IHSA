/**
 * Cloudflare Worker — Proxy seguro entre el cotizador y Cotizador-IHSA (privado).
 *
 * Cotizador (browser) → Worker (este código) → GitHub API → Worker → Cotizador
 *
 * El PAT vive como secret `GITHUB_PAT` y NUNCA llega al browser.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Endpoints
 * ─────────────────────────────────────────────────────────────────────────
 *   GET /health
 *   GET /data/<archivo>.json   (solo nombres en ALLOWED_FILES)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Env vars (Cloudflare → Settings → Variables)
 *   Secret:        GITHUB_PAT
 *   Plain:         GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, GITHUB_PATH,
 *                  ALLOWED_ORIGINS (csv)
 */

// 16 archivos permitidos: 11 originales + 5 nuevos.
const ALLOWED_FILES = new Set([
  // Originales (datos maestros)
  'sueldos.json',
  'iibb.json',
  'moviles.json',
  'trailers.json',
  'uniformes.json',
  'comunicacion.json',
  'consultorio.json',
  'estructura.json',
  'logistica.json',
  'medicacion.json',
  'defaults.json',
  // Nuevos (Dashboard + Mantenimiento + ZREAL)
  'moviles_dashboard.json',
  'trailers_dashboard.json',
  'costos_mantenimiento.json',
  'gastos_estructura_zreal.json',
  'categorias_estructura.json',
]);

const CACHE_TTL_SECONDS = 300;
const GITHUB_FETCH_TIMEOUT_MS = 8000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return handleCorsPreflight(request, env);
    if (request.method !== 'GET') return jsonResponse({ error: 'method_not_allowed' }, 405, request, env);

    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, ts: Date.now(), allowed_files: ALLOWED_FILES.size }, 200, request, env);
    }

    const match = url.pathname.match(/^\/data\/([^\/]+)$/);
    if (match) return handleDataRequest(match[1], request, env, ctx);

    return jsonResponse({ error: 'not_found' }, 404, request, env);
  },
};

async function handleDataRequest(filename, request, env, ctx) {
  if (!ALLOWED_FILES.has(filename)) {
    return jsonResponse({ error: 'file_not_allowed', filename }, 404, request, env);
  }

  const missingVars = ['GITHUB_PAT', 'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_PATH']
    .filter((v) => !env[v]);
  if (missingVars.length > 0) {
    return jsonResponse({ error: 'worker_misconfigured', missing: missingVars }, 500, request, env);
  }

  const cache = caches.default;
  const cacheKey = new Request(
    `https://internal-cache/${env.GITHUB_REPO}/${env.GITHUB_BRANCH}/${filename}`,
    { method: 'GET' },
  );
  const cached = await cache.match(cacheKey);
  if (cached) return withCors(cached, request, env, { 'X-Cache': 'HIT' });

  const githubUrl = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${env.GITHUB_PATH}/${filename}?ref=${env.GITHUB_BRANCH}`;

  let upstream;
  try {
    upstream = await fetchWithTimeout(githubUrl, {
      headers: {
        'Authorization': `Bearer ${env.GITHUB_PAT}`,
        'Accept': 'application/vnd.github.raw',
        'User-Agent': 'cotizador-ihsa-worker/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, GITHUB_FETCH_TIMEOUT_MS);
  } catch (err) {
    return jsonResponse({ error: 'github_unreachable', detail: err.message }, 502, request, env);
  }

  if (!upstream.ok) {
    const errorBody = await upstream.text().catch(() => '');
    let errorCode = 'github_error';
    let userMessage = `GitHub respondió ${upstream.status}`;

    if (upstream.status === 401) {
      errorCode = 'github_unauthorized';
      userMessage = 'PAT inválido o expirado';
    } else if (upstream.status === 403) {
      errorCode = 'github_forbidden';
      const remaining = upstream.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        errorCode = 'github_rate_limited';
        userMessage = 'Rate limit excedido en GitHub API';
      } else {
        userMessage = 'PAT sin permisos sobre este repo/archivo';
      }
    } else if (upstream.status === 404) {
      errorCode = 'github_file_not_found';
      userMessage = `El archivo ${filename} no existe en ${env.GITHUB_PATH}/`;
    }

    return jsonResponse(
      { error: errorCode, message: userMessage, status: upstream.status, github_response: errorBody.slice(0, 500) },
      upstream.status === 404 ? 404 : 502, request, env,
    );
  }

  const text = await upstream.text();
  try { JSON.parse(text); }
  catch (err) {
    return jsonResponse({ error: 'invalid_json_in_repo', filename, detail: err.message }, 502, request, env);
  }

  const response = new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
      'X-Cache': 'MISS',
    },
  });

  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return withCors(response, request, env);
}

// ─── CORS ──────────────────────────────────────────────────────────────────
function getAllowedOrigin(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const allowedRaw = (env.ALLOWED_ORIGINS || '').trim();
  if (!allowedRaw) return null;
  if (allowedRaw === '*') return '*';
  const allowed = allowedRaw.split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(requestOrigin) ? requestOrigin : null;
}

function corsHeaders(request, env, extra = {}) {
  const origin = getAllowedOrigin(request, env);
  const headers = { 'Vary': 'Origin', ...extra };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function handleCorsPreflight(request, env) {
  const origin = getAllowedOrigin(request, env);
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function withCors(response, request, env, extra = {}) {
  const newHeaders = new Headers(response.headers);
  const cors = corsHeaders(request, env, extra);
  for (const [k, v] of Object.entries(cors)) newHeaders.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
}

function jsonResponse(obj, status, request, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request, env) },
  });
}

async function fetchWithTimeout(url, options, ms) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...options, signal: ctl.signal }); }
  finally { clearTimeout(tid); }
}
