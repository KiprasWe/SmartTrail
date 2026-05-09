// lib/ai/trace.js — structured debug tracing for AI pipeline decisions.

import crypto from "crypto";

function toBool(v) {
  if (v === true) return true;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function clampInt(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(Math.trunc(x), hi));
}

function safeStr(v, max = 200) {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\r\n\t]/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function safePoi(poi) {
  if (!poi || typeof poi !== "object") return null;
  return {
    place_id: safeStr(poi.place_id, 120),
    name: safeStr(poi.name, 120),
    primary_type: safeStr(poi.primary_type, 60),
    lat: Number.isFinite(poi.lat) ? Number(poi.lat) : null,
    lng: Number.isFinite(poi.lng) ? Number(poi.lng) : null,
    rating: Number.isFinite(poi.rating) ? Number(poi.rating) : null,
    user_rating_count: Number.isFinite(poi.user_rating_count) ? Number(poi.user_rating_count) : null,
    essential: typeof poi.essential === "boolean" ? poi.essential : null,
    _userNamed: poi._userNamed === true ? true : null,
    _isUserWaypoint: poi._isUserWaypoint === true ? true : null,
  };
}

export function createAiTrace({ traceId, enabled, level } = {}) {
  const envEnabled = toBool(process.env.AI_TRACE);
  const envLevel = String(process.env.AI_TRACE_LEVEL ?? "").trim().toLowerCase();

  const isEnabled = enabled ?? envEnabled;
  const lvl = level ?? (envLevel === "detail" || envLevel === "verbose" ? "detail" : "summary");
  const perObjectLimit = clampInt(process.env.AI_TRACE_OBJECT_LIMIT ?? 60, 0, 500);

  const id =
    traceId ||
    (crypto.randomUUID ? crypto.randomUUID() : `trace_${Date.now()}_${Math.random().toString(16).slice(2)}`);

  let objectLogs = 0;

  function emit(event, data) {
    if (!isEnabled) return;
    const payload = {
      ts: new Date().toISOString(),
      traceId: id,
      scope: "aiRouting",
      event,
      ...(data && typeof data === "object" ? data : {}),
    };
    console.log(`[aiTrace] ${JSON.stringify(payload)}`);
  }

  return {
    id,
    enabled: isEnabled,
    level: lvl,

    stage(stage, data) {
      emit("stage", { stage: safeStr(stage, 60), ...(data ?? {}) });
    },

    metric(name, value, data) {
      emit("metric", { name: safeStr(name, 80), value, ...(data ?? {}) });
    },

    note(message, data) {
      emit("note", { message: safeStr(message, 400), ...(data ?? {}) });
    },

    decision(kind, data) {
      if (!isEnabled) return;
      if (lvl !== "detail") return;
      if (perObjectLimit === 0) return;
      if (objectLogs >= perObjectLimit) return;
      objectLogs++;
      emit("decision", { kind: safeStr(kind, 80), ...(data ?? {}) });
    },

    poiDecision(kind, poi, data) {
      this.decision(kind, { poi: safePoi(poi), ...(data ?? {}) });
    },

    summary(name, data) {
      emit("summary", { name: safeStr(name, 80), ...(data ?? {}) });
    },
  };
}

